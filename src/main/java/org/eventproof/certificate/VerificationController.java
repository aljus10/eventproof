package org.eventproof.certificate;

import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/verify")
public class VerificationController {
    private final CertificateService certificates;
    public VerificationController(CertificateService certificates) { this.certificates = certificates; }

    @GetMapping("/{certificateId}")
    public CertificateService.VerificationView verify(@PathVariable String certificateId, @RequestParam(required = false) String token) {
        return certificates.verify(certificateId, token);
    }
}
