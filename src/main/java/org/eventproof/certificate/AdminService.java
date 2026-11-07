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
                .map(e -> new EventSummary(e.getId(), e.getName(), e.getEventDate().toString(), e.getVenue(),
                        registrations.countByEventId(e.getId()),
                        attendance.countByEventId(e.getId()),
                        certificates.countByRegistrationEventId(e.getId())))
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
        t.setBackgroundImage(req.backgroundImage() != null && !req.backgroundImage().isBlank() ? req.backgroundImage() : null);
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

    public static final String DEFAULT_LAYOUT_JSON = """
            {"width":842,"height":595,"orientation":"LANDSCAPE","elements":[{"id":"crest","type":"crest","label":"EMBLEM_CREST","x":421,"y":55,"width":36,"height":36},{"id":"subhead","type":"text","label":"SUBHEADER","text":"INSTITUTIONAL ACADEMIC & PROFESSIONAL CREDENTIAL","x":421,"y":95,"fontSize":9,"isBold":true,"color":"#64748b","align":"center"},{"id":"title","type":"text","label":"MAIN_TITLE","text":"CERTIFICATE OF PARTICIPATION","x":421,"y":135,"fontSize":24,"isBold":true,"color":"#0f172a","align":"center"},{"id":"presented","type":"text","label":"PRESENTED_TO","text":"THIS IS PROUDLY PRESENTED TO","x":421,"y":175,"fontSize":10,"isBold":false,"color":"#64748b","align":"center"},{"id":"part_name","type":"field","field":"PARTICIPANT_NAME","label":"PARTICIPANT_NAME","placeholder":"{{PARTICIPANT_NAME}}","x":421,"y":230,"fontSize":28,"isBold":true,"color":"#1e3a8a","align":"center","width":440,"height":38},{"id":"prog","type":"field","field":"PROGRAM","label":"PROGRAM","placeholder":"{{PROGRAM}}","x":421,"y":265,"fontSize":12,"isBold":false,"color":"#475569","align":"center","width":340,"height":24},{"id":"body_text","type":"text","label":"BODY_PARAGRAPH","text":"for actively participating and successfully completing the institutional plenary requirements of","x":421,"y":305,"fontSize":9,"isBold":false,"color":"#64748b","align":"center"},{"id":"evt_name","type":"field","field":"EVENT_NAME","label":"EVENT_NAME","placeholder":"{{EVENT_NAME}}","x":421,"y":350,"fontSize":18,"isBold":true,"color":"#0f172a","align":"center","width":480,"height":32},{"id":"evt_venue","type":"field","field":"EVENT_VENUE","label":"EVENT_VENUE","placeholder":"{{EVENT_VENUE}}","x":421,"y":385,"fontSize":10,"isBold":false,"color":"#475569","align":"center","width":380,"height":22},{"id":"organizer","type":"field","field":"ORGANIZER","label":"ORGANIZER","placeholder":"{{ORGANIZER}}","x":421,"y":408,"fontSize":9,"isBold":false,"color":"#64748b","align":"center","width":380,"height":20},{"id":"qr","type":"qr","field":"VERIFICATION_QR","label":"VERIFICATION_QR","x":115,"y":475,"width":75,"height":75},{"id":"cert_id","type":"field","field":"CERTIFICATE_ID","label":"CERTIFICATE_ID","placeholder":"{{CERTIFICATE_ID}}","x":115,"y":528,"fontSize":8,"isBold":false,"color":"#475569","align":"center","width":110,"height":18},{"id":"sig1","type":"field","field":"SIGNATORY_1","label":"SIGNATORY_1","placeholder":"Dr. Roberto M. Gomez Dean, College of Science","subtext":"Authorized Officer / Coordinator","x":390,"y":480,"fontSize":10,"isBold":true,"color":"#0f172a","align":"center","width":220,"height":42},{"id":"sig2","type":"field","field":"SIGNATORY_2","label":"SIGNATORY_2","placeholder":"Prof. Maria Santos Department Chair","subtext":"Dean / Department Chairperson","x":630,"y":480,"fontSize":10,"isBold":true,"color":"#0f172a","align":"center","width":220,"height":42},{"id":"footer_tag","type":"text","label":"FOOTER_TAG","text":"EVENTPROOF CRYPTOGRAPHIC VERIFICATION SYSTEM • ED25519 DIGITAL SIGNATURE • TAMPER EVIDENT","x":421,"y":560,"fontSize":7,"isBold":false,"color":"#94a3b8","align":"center"}]}""";

    @Transactional
    public TemplateView resetToDefault(Long id) {
        CertificateTemplate t = templates.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Template not found"));
        t.setBackgroundImage(null);
        t.setLayoutJson(DEFAULT_LAYOUT_JSON);
        t.setWidth(842);
        t.setHeight(595);
        t.setOrientation("LANDSCAPE");
        t.setUpdatedAt(Instant.now());
        return toTemplateView(templates.save(t));
    }

    public record EventSummary(Long id, String name, String eventDate, String venue, long registered, long present, long certificatesIssued) {}
    public record EligibilityView(Long registrationId, String studentNumber, String fullName, String program, boolean present, String eligibility, String certificateId, String certificateStatus) {}
    public record UserView(Long id, String username, String role, boolean enabled) {}
    public record TemplateView(Long id, String name, Long eventId, String eventName, boolean isDefault, int width, int height, String orientation, String layoutJson, String backgroundImage, Instant createdAt, Instant updatedAt) {}
    public record TemplateRequest(Long id, String name, Long eventId, boolean isDefault, int width, int height, String orientation, String layoutJson, String backgroundImage) {}
}
