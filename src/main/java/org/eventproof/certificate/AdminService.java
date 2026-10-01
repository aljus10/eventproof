package org.eventproof.certificate;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.rendering.PDFRenderer;
import org.eventproof.attendance.Attendance;
import org.eventproof.attendance.AttendanceRepository;
import org.eventproof.auth.UserAccount;
import org.eventproof.auth.UserAccountRepository;
import org.eventproof.common.DomainEnums.Role;
import org.eventproof.event.Event;
import org.eventproof.event.EventRegistration;
import org.eventproof.event.EventRegistrationRepository;
import org.eventproof.event.EventRepository;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.Instant;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

@Service
public class AdminService {
    private final EventRepository events;
    private final EventRegistrationRepository registrations;
    private final AttendanceRepository attendance;
    private final CertificateRepository certificates;
    private final UserAccountRepository users;
    private final PasswordEncoder encoder;
    private final CertificateService certificateService;
    private final CertificateTemplateRepository templates;

    public AdminService(EventRepository events, EventRegistrationRepository registrations, AttendanceRepository attendance,
                        CertificateRepository certificates, UserAccountRepository users, PasswordEncoder encoder,
                        CertificateService certificateService, CertificateTemplateRepository templates) {
        this.events = events; this.registrations = registrations; this.attendance = attendance; this.certificates = certificates;
        this.users = users; this.encoder = encoder; this.certificateService = certificateService; this.templates = templates;
    }

    @Transactional(readOnly = true)
    public List<EventSummary> events() {
        return events.findAll().stream().sorted(Comparator.comparing(Event::getEventDate).reversed())
                .map(e -> new EventSummary(e.getId(), e.getName(), e.getEventDate().toString(), e.getVenue(), registrations.countByEventId(e.getId()), attendance.countByEventId(e.getId())))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<EligibilityView> eligibility(Long eventId) {
        if (!events.existsById(eventId)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Event not found");
        Map<Long, Attendance> present = attendance.findByEventId(eventId).stream()
                .collect(Collectors.toMap(a -> a.getRegistration().getId(), Function.identity()));
        Map<Long, Certificate> certs = certificates.findByRegistrationEventId(eventId).stream()
                .collect(Collectors.toMap(c -> c.getRegistration().getId(), Function.identity()));
        return registrations.findByEventIdOrderByStudentFullNameAsc(eventId).stream().map(r -> {
            Attendance a = present.get(r.getId());
            Certificate c = certs.get(r.getId());
            return new EligibilityView(r.getId(), r.getStudent().getStudentNumber(), r.getStudent().getFullName(), r.getStudent().getProgram(),
                    a != null, a == null ? "Absent" : "Eligible", c == null ? null : c.getCertificateId(), c == null ? null : c.getStatus().name());
        }).toList();
    }

    @Transactional
    public List<CertificateService.CertificateView> generateAll(Long eventId) {
        if (!events.existsById(eventId)) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Event not found");
        List<Attendance> attendances = attendance.findByEventId(eventId);
        List<CertificateService.CertificateView> generated = new ArrayList<>();
        for (Attendance a : attendances) {
            try {
                generated.add(certificateService.generate(a.getRegistration().getId()));
            } catch (Exception ignored) {}
        }
        return generated;
    }

    @Transactional(readOnly = true)
    public byte[] generateZip(Long eventId, String baseUrl) {
        List<Certificate> certs = certificates.findByRegistrationEventId(eventId);
        if (certs.isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "No certificates issued for this event yet");
        try (ByteArrayOutputStream baos = new ByteArrayOutputStream();
             ZipOutputStream zos = new ZipOutputStream(baos)) {
            for (Certificate c : certs) {
                byte[] pdfBytes = certificateService.pdf(c.getCertificateId(), baseUrl);
                String safeName = c.getRegistration().getStudent().getFullName().replaceAll("[^a-zA-Z0-9_-]", "_");
                String filename = String.format("%s_%s_%s.pdf",
                        c.getRegistration().getStudent().getStudentNumber(), safeName, c.getCertificateId());
                ZipEntry entry = new ZipEntry(filename);
                zos.putNextEntry(entry);
                zos.write(pdfBytes);
                zos.closeEntry();
            }
            zos.finish();
            return baos.toByteArray();
        } catch (IOException e) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to compile ZIP archive", e);
        }
    }

    @Transactional(readOnly = true)
    public List<TemplateView> templates() {
        return templates.findAllByOrderByCreatedAtDesc().stream().map(this::toTemplateView).toList();
    }

    @Transactional(readOnly = true)
    public TemplateView template(Long id) {
        return templates.findById(id).map(this::toTemplateView)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Template not found"));
    }

    @Transactional(readOnly = true)
    public TemplateView templateForEvent(Long eventId) {
        CertificateTemplate t = templates.findByEventId(eventId)
                .orElseGet(() -> templates.findFirstByIsDefaultTrue()
                        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Default template not found")));
        return toTemplateView(t);
    }

    @Transactional
    public TemplateView saveTemplate(TemplateRequest req) {
        CertificateTemplate t = req.id() != null ? templates.findById(req.id()).orElse(new CertificateTemplate()) : new CertificateTemplate();
        t.setName(req.name());
        if (req.eventId() != null) {
            Event event = events.findById(req.eventId()).orElse(null);
            t.setEvent(event);
        } else {
            t.setEvent(null);
        }
        t.setDefault(req.isDefault());
        t.setWidth(req.width() > 0 ? req.width() : 842);
        t.setHeight(req.height() > 0 ? req.height() : 595);
        t.setOrientation(req.orientation() != null ? req.orientation() : "LANDSCAPE");
        t.setLayoutJson(req.layoutJson());
        if (req.backgroundImage() != null) {
            t.setBackgroundImage(req.backgroundImage());
        }
        Instant now = Instant.now();
        if (t.getCreatedAt() == null) t.setCreatedAt(now);
        t.setUpdatedAt(now);
        return toTemplateView(templates.save(t));
    }

    @Transactional
    public TemplateView uploadBackground(Long id, byte[] fileBytes, String contentType) {
        CertificateTemplate t = templates.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Template not found"));
        String base64Image;
        if (contentType != null && contentType.toLowerCase().contains("pdf")) {
            try (PDDocument doc = org.apache.pdfbox.Loader.loadPDF(fileBytes)) {
                PDFRenderer renderer = new PDFRenderer(doc);
                BufferedImage bim = renderer.renderImageWithDPI(0, 150);
                ByteArrayOutputStream baos = new ByteArrayOutputStream();
                ImageIO.write(bim, "png", baos);
                base64Image = "data:image/png;base64," + Base64.getEncoder().encodeToString(baos.toByteArray());
            } catch (IOException e) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid PDF template file: " + e.getMessage());
            }
        } else {
            String mime = contentType != null && !contentType.isBlank() ? contentType : "image/png";
            base64Image = "data:" + mime + ";base64," + Base64.getEncoder().encodeToString(fileBytes);
        }
        t.setBackgroundImage(base64Image);
        t.setUpdatedAt(Instant.now());
        return toTemplateView(templates.save(t));
    }

    @Transactional
    public void deleteTemplate(Long id) {
        CertificateTemplate t = templates.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Template not found"));
        if (t.isDefault()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Cannot delete the default template");
        }
        templates.delete(t);
    }

    private TemplateView toTemplateView(CertificateTemplate t) {
        return new TemplateView(t.getId(), t.getName(), t.getEvent() != null ? t.getEvent().getId() : null,
                t.getEvent() != null ? t.getEvent().getName() : null, t.isDefault(), t.getWidth(), t.getHeight(),
                t.getOrientation(), t.getLayoutJson(), t.getBackgroundImage(), t.getCreatedAt(), t.getUpdatedAt());
    }

    @Transactional(readOnly = true)
    public List<UserView> users() {
        return users.findAll().stream().map(u -> new UserView(u.getId(), u.getUsername(), u.getRole().name(), u.isEnabled())).toList();
    }

    @Transactional
    public UserView addUser(String username, String password, Role role) {
        if (users.findByUsername(username).isPresent()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Username already exists");
        }
        UserAccount u = new UserAccount();
        u.setUsername(username);
        u.setPasswordHash(encoder.encode(password));
        u.setRole(role);
        u.setEnabled(true);
        return new UserView(users.save(u).getId(), u.getUsername(), u.getRole().name(), u.isEnabled());
    }

    public record EventSummary(Long id, String name, String eventDate, String venue, long registered, long present) {}
    public record EligibilityView(Long registrationId, String studentNumber, String fullName, String program, boolean present, String eligibility, String certificateId, String certificateStatus) {}
    public record UserView(Long id, String username, String role, boolean enabled) {}
    public record TemplateView(Long id, String name, Long eventId, String eventName, boolean isDefault, int width, int height, String orientation, String layoutJson, String backgroundImage, Instant createdAt, Instant updatedAt) {}
    public record TemplateRequest(Long id, String name, Long eventId, boolean isDefault, int width, int height, String orientation, String layoutJson, String backgroundImage) {}
}
