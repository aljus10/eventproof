package org.eventproof.certificate;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.apache.pdfbox.pdmodel.graphics.image.PDImageXObject;
import org.eventproof.attendance.AttendanceRepository;
import org.eventproof.common.DomainEnums.CertificateStatus;
import org.eventproof.common.QrCodeService;
import org.eventproof.common.SignatureService;
import org.eventproof.event.EventRegistration;
import org.eventproof.event.EventRegistrationRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.UUID;

@Service
public class CertificateService {
    private final CertificateRepository certificates;
    private final EventRegistrationRepository registrations;
    private final AttendanceRepository attendance;
    private final SignatureService signatures;
    private final QrCodeService qrCodes;
    private final CertificateTemplateRepository templates;
    private final ObjectMapper json;

    public CertificateService(CertificateRepository certificates, EventRegistrationRepository registrations,
                              AttendanceRepository attendance, SignatureService signatures, QrCodeService qrCodes,
                              CertificateTemplateRepository templates, ObjectMapper json) {
        this.certificates = certificates; this.registrations = registrations; this.attendance = attendance;
        this.signatures = signatures; this.qrCodes = qrCodes; this.templates = templates; this.json = json;
    }

    @Transactional
    public CertificateView generate(Long registrationId) {
        EventRegistration registration = registrations.findDetailedById(registrationId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Registration not found"));
        if (attendance.findByEventIdAndRegistrationId(registration.getEvent().getId(), registrationId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Only present attendees are certificate eligible");
        }
        Certificate existing = certificates.findByRegistrationId(registrationId).orElse(null);
        if (existing != null) return view(existing);
        Certificate c = new Certificate();
        c.setCertificateId("EP-" + UUID.randomUUID().toString().replace("-", "").substring(0, 10).toUpperCase(Locale.ROOT));
        c.setRegistration(registration);
        c.setIssuedAt(Instant.now());
        c.setStatus(CertificateStatus.VALID);
        return view(certificates.save(c));
    }

    @Transactional(readOnly = true)
    public CertificateView get(String certificateId) {
        Certificate c = certificates.findByCertificateId(certificateId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Certificate not found"));
        return view(c);
    }

    @Transactional(readOnly = true)
    public VerificationView verify(String certificateId, String token) {
        Certificate c = certificates.findByCertificateId(certificateId).orElse(null);
        if (c == null) return new VerificationView("UNKNOWN", null, null, null, certificateId);
        if (!signatures.verifyCertificateToken(certificateId, token)) {
            return new VerificationView("INVALID", null, null, null, certificateId);
        }
        EventRegistration r = c.getRegistration();
        String status = c.getStatus() == CertificateStatus.REVOKED ? "REVOKED" : "VALID";
        return new VerificationView(status, r.getStudent().getFullName(), r.getEvent().getName(), c.getIssuedAt(), c.getCertificateId());
    }

    @Transactional(readOnly = true)
    public byte[] pdf(String certificateId, String verificationBaseUrl) {
        Certificate c = certificates.findByCertificateId(certificateId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Certificate not found"));
        EventRegistration r = c.getRegistration();
        String token = signatures.certificateVerificationToken(certificateId);
        String verifyUrl = verificationBaseUrl + "/verify.html?id=" + certificateId + "&token=" + token;
        byte[] qr = qrCodes.png(verifyUrl, 240);

        // Find active template (Event-specific or Global Default)
        CertificateTemplate template = templates.findByEventId(r.getEvent().getId())
                .orElseGet(() -> templates.findFirstByIsDefaultTrue().orElse(null));

        if (template != null && template.getLayoutJson() != null && !template.getLayoutJson().isBlank()) {
            try {
                return renderFromTemplate(template.getLayoutJson(), template.getBackgroundImage(), r.getStudent().getFullName(),
                        r.getStudent().getStudentNumber(), r.getStudent().getProgram(),
                        r.getEvent().getName(), r.getEvent().getVenue(), r.getEvent().getEventDate(),
                        c.getCertificateId(), c.getIssuedAt(), c.getStatus().name(), qr);
            } catch (Exception ignored) {
                // Fallback to standard rendering if template fails
            }
        }
        return renderDefaultPdf(c, r, qr);
    }

    @Transactional
    public CertificateView revoke(String certificateId) {
        Certificate c = certificates.findByCertificateId(certificateId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Certificate not found"));
        c.setStatus(CertificateStatus.REVOKED);
        return view(certificates.save(c));
    }

    @Transactional
    public CertificateView unrevoke(String certificateId) {
        Certificate c = certificates.findByCertificateId(certificateId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Certificate not found"));
        c.setStatus(CertificateStatus.VALID);
        return view(certificates.save(c));
    }

    public byte[] samplePdf(String layoutJson, String backgroundImage, String verificationBaseUrl) {
        byte[] qr = qrCodes.png(verificationBaseUrl + "/verify.html?id=EP-SAMPLE001&token=sample-token", 240);
        return renderFromTemplate(layoutJson, backgroundImage, "JUAN DELA CRUZ", "2026-0001", "BS Information Technology",
                "Emerging Technologies Seminar 2026", "BU Polangui Campus", LocalDate.now(),
                "EP-SAMPLE001", Instant.now(), "VALID", qr);
    }

    private byte[] renderFromTemplate(String layoutJson, String backgroundImage, String studentName, String studentNumber, String program,
                                      String eventName, String venue, LocalDate eventDate,
                                      String certificateId, Instant issuedAt, String status, byte[] qrBytes) {
        try (PDDocument doc = new PDDocument(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            JsonNode root = json.readTree(layoutJson);
            float width = root.has("width") ? (float) root.get("width").asDouble(842) : 842f;
            float height = root.has("height") ? (float) root.get("height").asDouble(595) : 595f;

            PDPage page = new PDPage(new PDRectangle(width, height));
            doc.addPage(page);

            PDType1Font regular = new PDType1Font(Standard14Fonts.FontName.HELVETICA);
            PDType1Font bold = new PDType1Font(Standard14Fonts.FontName.HELVETICA_BOLD);

            try (PDPageContentStream cs = new PDPageContentStream(doc, page)) {
                // Check if custom background image / PDF was uploaded
                if (backgroundImage != null && !backgroundImage.isBlank()) {
                    try {
                        byte[] bgBytes = null;
                        if (backgroundImage.contains(",")) {
                            bgBytes = java.util.Base64.getDecoder().decode(backgroundImage.substring(backgroundImage.indexOf(',') + 1));
                        }
                        if (bgBytes != null && bgBytes.length > 0) {
                            PDImageXObject bgImg = PDImageXObject.createFromByteArray(doc, bgBytes, "custom-bg");
                            cs.drawImage(bgImg, 0, 0, width, height);
                        }
                    } catch (Exception ignored) {}
                } else {
                    // Decorative Classical Multi-Border
                    cs.setLineWidth(2.2f);
                    cs.setStrokingColor(16 / 255f, 35 / 255f, 63 / 255f); // Deep Navy
                    cs.addRect(26, 26, width - 52, height - 52);
                    cs.stroke();

                    cs.setLineWidth(1.0f);
                    cs.setStrokingColor(202 / 255f, 160 / 255f, 75 / 255f); // Gold Accent
                    cs.addRect(33, 33, width - 66, height - 66);
                    cs.stroke();

                    cs.setLineWidth(0.6f);
                    cs.setStrokingColor(16 / 255f, 35 / 255f, 63 / 255f);
                    cs.addRect(37, 37, width - 74, height - 74);
                    cs.stroke();
                }

                DateTimeFormatter dateFmt = DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.ENGLISH);

                String formattedEventDate = eventDate != null ? eventDate.format(dateFmt) : "";
                String formattedIssueDate = issuedAt != null ? issuedAt.atZone(ZoneId.systemDefault()).format(dateFmt) : "";

                JsonNode elements = root.get("elements");
                if (elements != null && elements.isArray()) {
                    for (JsonNode el : elements) {
                        String type = el.has("type") ? el.get("type").asText() : "text";
                        float elX = (float) el.path("x").asDouble(width / 2f);
                        float elY = (float) el.path("y").asDouble(height / 2f);
                        float fontSize = (float) el.path("fontSize").asDouble(12);
                        boolean isBold = el.path("isBold").asBoolean(false);
                        String align = el.path("align").asText("center");
                        PDType1Font font = isBold ? bold : regular;

                        // PDF coordinate: y=0 at bottom
                        float pdfY = height - elY;

                        if ("crest".equalsIgnoreCase(type)) {
                            drawEmblemCrest(cs, elX, pdfY, 36);
                        } else if ("qr".equalsIgnoreCase(type) || "VERIFICATION_QR".equals(el.path("field").asText())) {
                            float qrSize = (float) el.path("width").asDouble(75);
                            PDImageXObject qrImg = PDImageXObject.createFromByteArray(doc, qrBytes, "qr");
                            float qrX = "center".equalsIgnoreCase(align) ? elX - (qrSize / 2f) : elX;
                            cs.drawImage(qrImg, qrX, pdfY - qrSize, qrSize, qrSize);
                        } else {
                            // Text or Field
                            String text = "";
                            if ("field".equalsIgnoreCase(type)) {
                                String fieldKey = el.path("field").asText("");
                                text = switch (fieldKey) {
                                    case "PARTICIPANT_NAME" -> studentName.toUpperCase(Locale.ROOT);
                                    case "STUDENT_NUMBER", "STUDENT_ID" -> studentNumber;
                                    case "PROGRAM" -> program;
                                    case "EVENT_NAME" -> eventName.toUpperCase(Locale.ROOT);
                                    case "EVENT_VENUE" -> venue;
                                    case "EVENT_DATE" -> formattedEventDate;
                                    case "ORGANIZER" -> "BU Polangui Academic Council";
                                    case "CERTIFICATE_ID" -> certificateId;
                                    case "ISSUE_DATE" -> formattedIssueDate;
                                    case "SIGNATORY_1" -> el.path("placeholder").asText("Dr. Roberto M. Gomez Dean, College of Science");
                                    case "SIGNATORY_2" -> el.path("placeholder").asText("Prof. Maria Santos Department Chair");
                                    default -> el.path("placeholder").asText("");
                                };
                            } else {
                                text = el.path("text").asText("");
                            }

                            if (!text.isBlank()) {
                                applyColor(cs, el.path("color").asText("#0f172a"));
                                drawAlignedString(cs, font, fontSize, text, elX, pdfY, align);

                                // If field has subtext (e.g. Signatory title/role)
                                if (el.has("subtext") && !el.get("subtext").asText().isBlank()) {
                                    applyColor(cs, "#64748b");
                                    drawAlignedString(cs, regular, Math.max(8, fontSize - 2), el.get("subtext").asText(), elX, pdfY - 14, align);
                                }
                            }
                        }
                    }
                }
            }
            doc.save(out);
            return out.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException("Unable to generate custom certificate PDF", e);
        }
    }

    private void drawEmblemCrest(PDPageContentStream cs, float cx, float cy, float size) throws IOException {
        float r = size / 2f;
        cs.setLineWidth(1.2f);
        cs.setStrokingColor(202 / 255f, 160 / 255f, 75 / 255f);
        cs.setNonStrokingColor(16 / 255f, 35 / 255f, 63 / 255f);
        // Shield shape
        cs.moveTo(cx - r, cy + (r * 0.6f));
        cs.lineTo(cx + r, cy + (r * 0.6f));
        cs.lineTo(cx + (r * 0.85f), cy - (r * 0.3f));
        cs.lineTo(cx, cy - r);
        cs.lineTo(cx - (r * 0.85f), cy - (r * 0.3f));
        cs.closePath();
        cs.fillAndStroke();
    }

    private void applyColor(PDPageContentStream cs, String hexColor) throws IOException {
        if (hexColor != null && hexColor.startsWith("#") && hexColor.length() == 7) {
            try {
                int r = Integer.parseInt(hexColor.substring(1, 3), 16);
                int g = Integer.parseInt(hexColor.substring(3, 5), 16);
                int b = Integer.parseInt(hexColor.substring(5, 7), 16);
                cs.setNonStrokingColor(r / 255f, g / 255f, b / 255f);
                return;
            } catch (Exception ignored) {}
        }
        cs.setNonStrokingColor(15 / 255f, 23 / 255f, 42 / 255f);
    }

    private void drawAlignedString(PDPageContentStream cs, PDType1Font font, float fontSize, String text, float x, float y, String align) throws IOException {
        float stringWidth = font.getStringWidth(text) / 1000f * fontSize;
        float startX = switch (align.toLowerCase(Locale.ROOT)) {
            case "center" -> x - (stringWidth / 2f);
            case "right" -> x - stringWidth;
            default -> x;
        };
        cs.beginText();
        cs.setFont(font, fontSize);
        cs.newLineAtOffset(startX, y);
        cs.showText(text);
        cs.endText();
    }

    private byte[] renderDefaultPdf(Certificate c, EventRegistration r, byte[] qr) {
        try (PDDocument doc = new PDDocument(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            PDPage page = new PDPage(new PDRectangle(842, 595));
            doc.addPage(page);
            PDType1Font regular = new PDType1Font(Standard14Fonts.FontName.HELVETICA);
            PDType1Font bold = new PDType1Font(Standard14Fonts.FontName.HELVETICA_BOLD);
            try (PDPageContentStream cs = new PDPageContentStream(doc, page)) {
                cs.setLineWidth(2f);
                cs.addRect(28, 28, 786, 539);
                cs.stroke();
                cs.setLineWidth(0.7f);
                cs.addRect(38, 38, 766, 519);
                cs.stroke();

                centered(cs, bold, 16, "EVENTPROOF", 510, 842);
                centered(cs, bold, 30, "CERTIFICATE OF PARTICIPATION", 455, 842);
                centered(cs, regular, 14, "This certificate is presented to", 405, 842);
                centered(cs, bold, fitFont(r.getStudent().getFullName().toUpperCase(Locale.ROOT), 32), r.getStudent().getFullName().toUpperCase(Locale.ROOT), 350, 842);
                centered(cs, regular, 14, "for participating in", 305, 842);
                centered(cs, bold, fitFont(r.getEvent().getName().toUpperCase(Locale.ROOT), 23), r.getEvent().getName().toUpperCase(Locale.ROOT), 265, 842);

                String eventDate = r.getEvent().getEventDate().format(DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.ENGLISH));
                centered(cs, regular, 13, eventDate + "  |  " + r.getEvent().getVenue(), 225, 842);
                String issueDate = c.getIssuedAt().atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.ENGLISH));
                left(cs, regular, 9, "Issued: " + issueDate + "  |  Status: " + c.getStatus().name(), 65, 98);
                left(cs, regular, 10, "Certificate ID: " + c.getCertificateId(), 65, 78);
                left(cs, regular, 8, "Scan the QR code to verify this certificate.", 65, 58);

                PDImageXObject qrImage = PDImageXObject.createFromByteArray(doc, qr, "verification-qr");
                cs.drawImage(qrImage, 690, 52, 95, 95);
            }
            doc.save(out);
            return out.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException("Unable to generate certificate PDF", e);
        }
    }

    private void left(PDPageContentStream cs, PDType1Font font, float size, String text, float x, float y) throws IOException {
        cs.beginText();
        cs.setFont(font, size);
        cs.newLineAtOffset(x, y);
        cs.showText(text);
        cs.endText();
    }

    private float fitFont(String text, float preferred) {
        if (text.length() > 45) return 20;
        if (text.length() > 32) return 24;
        return preferred;
    }

    private void centered(PDPageContentStream cs, PDType1Font font, float size, String text, float y, float pageWidth) throws IOException {
        float width = font.getStringWidth(text) / 1000f * size;
        cs.beginText();
        cs.setFont(font, size);
        cs.newLineAtOffset((pageWidth - width) / 2f, y);
        cs.showText(text);
        cs.endText();
    }

    private CertificateView view(Certificate c) {
        EventRegistration r = c.getRegistration();
        return new CertificateView(c.getCertificateId(), r.getId(), r.getStudent().getFullName(), r.getStudent().getStudentNumber(),
                r.getEvent().getName(), r.getEvent().getId(), c.getIssuedAt(), c.getStatus().name(), signatures.certificateVerificationToken(c.getCertificateId()));
    }

    public record CertificateView(String certificateId, Long registrationId, String participant, String studentNumber,
                                  String eventName, Long eventId, Instant issuedAt, String status, String verificationToken) {}
    public record VerificationView(String status, String participant, String eventName, Instant issueDate, String certificateId) {}
}
