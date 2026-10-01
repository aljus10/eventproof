package org.eventproof.certificate;

import jakarta.servlet.http.HttpServletRequest;
import org.eventproof.common.DomainEnums.Role;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/admin")
public class AdminController {
    private final AdminService admin;
    private final CertificateService certificates;

    public AdminController(AdminService admin, CertificateService certificates) {
        this.admin = admin;
        this.certificates = certificates;
    }

    @GetMapping("/events")
    public List<AdminService.EventSummary> events() {
        return admin.events();
    }

    @GetMapping("/events/{eventId}/eligibility")
    public List<AdminService.EligibilityView> eligibility(@PathVariable Long eventId) {
        return admin.eligibility(eventId);
    }

    @PostMapping("/certificates/generate")
    public CertificateService.CertificateView generate(@RequestBody GenerateRequest request) {
        return certificates.generate(request.registrationId());
    }

    @PostMapping("/events/{eventId}/certificates/generate-all")
    public List<CertificateService.CertificateView> generateAll(@PathVariable Long eventId) {
        return admin.generateAll(eventId);
    }

    @GetMapping(value = "/events/{eventId}/certificates/zip", produces = "application/zip")
    public ResponseEntity<byte[]> zip(@PathVariable Long eventId, HttpServletRequest request) {
        String base = extractBaseUrl(request);
        byte[] zipBytes = admin.generateZip(eventId, base);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"event-" + eventId + "-certificates.zip\"")
                .contentType(MediaType.parseMediaType("application/zip"))
                .body(zipBytes);
    }

    @PostMapping("/certificates/{certificateId}/revoke")
    public CertificateService.CertificateView revoke(@PathVariable String certificateId) {
        return certificates.revoke(certificateId);
    }

    @PostMapping("/certificates/{certificateId}/unrevoke")
    public CertificateService.CertificateView unrevoke(@PathVariable String certificateId) {
        return certificates.unrevoke(certificateId);
    }

    @GetMapping(value = "/certificates/{certificateId}/pdf", produces = MediaType.APPLICATION_PDF_VALUE)
    public ResponseEntity<byte[]> pdf(@PathVariable String certificateId, HttpServletRequest request) {
        String base = extractBaseUrl(request);
        byte[] pdf = certificates.pdf(certificateId, base);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + certificateId + ".pdf\"")
                .contentType(MediaType.APPLICATION_PDF)
                .body(pdf);
    }

    @GetMapping("/templates")
    public List<AdminService.TemplateView> templates() {
        return admin.templates();
    }

    @GetMapping("/templates/{id}")
    public AdminService.TemplateView template(@PathVariable Long id) {
        return admin.template(id);
    }

    @GetMapping("/templates/for-event/{eventId}")
    public AdminService.TemplateView templateForEvent(@PathVariable Long eventId) {
        return admin.templateForEvent(eventId);
    }

    @PostMapping("/templates")
    public AdminService.TemplateView saveTemplate(@RequestBody AdminService.TemplateRequest req) {
        return admin.saveTemplate(req);
    }

    @DeleteMapping("/templates/{id}")
    public ResponseEntity<Void> deleteTemplate(@PathVariable Long id) {
        admin.deleteTemplate(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/templates/{id}/background")
    public AdminService.TemplateView uploadBackground(@PathVariable Long id, @RequestParam("file") org.springframework.web.multipart.MultipartFile file) throws IOException {
        return admin.uploadBackground(id, file.getBytes(), file.getContentType());
    }

    @PostMapping(value = "/templates/sample-pdf", produces = MediaType.APPLICATION_PDF_VALUE)
    public ResponseEntity<byte[]> samplePdf(@RequestBody Map<String, String> body, HttpServletRequest request) {
        String base = extractBaseUrl(request);
        String layoutJson = body.getOrDefault("layoutJson", "{}");
        String backgroundImage = body.get("backgroundImage");
        byte[] sample = certificates.samplePdf(layoutJson, backgroundImage, base);
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"sample-certificate.pdf\"")
                .contentType(MediaType.APPLICATION_PDF)
                .body(sample);
    }


    @GetMapping("/users")
    public List<AdminService.UserView> users() {
        return admin.users();
    }

    @PostMapping("/users")
    public AdminService.UserView addUser(@RequestBody UserRequest request) {
        return admin.addUser(request.username(), request.password(), request.role());
    }

    @GetMapping("/settings")
    public Map<String, Object> settings() {
        return Map.of(
                "application", "EventProof",
                "database", "Embedded H2 file database (./data/eventproof)",
                "networkMode", "Local LAN / offline-first router",
                "certificateSigning", "Ed25519 (RFC 8032)",
                "publicKeyPath", "./data/eventproof-ed25519-public.key"
        );
    }

    private String extractBaseUrl(HttpServletRequest request) {
        return request.getScheme() + "://" + request.getServerName()
                + ((request.getServerPort() == 80 || request.getServerPort() == 443) ? "" : ":" + request.getServerPort());
    }

    public record GenerateRequest(Long registrationId) {}
    public record UserRequest(String username, String password, Role role) {}
}
