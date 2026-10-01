package org.eventproof.certificate;

import jakarta.persistence.*;
import org.eventproof.common.DomainEnums.CertificateStatus;
import org.eventproof.event.EventRegistration;
import java.time.Instant;

@Entity
@Table(name = "certificates")
public class Certificate {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(name = "certificate_id", nullable = false, unique = true, length = 80)
    private String certificateId;
    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "registration_id", nullable = false, unique = true)
    private EventRegistration registration;
    @Column(name = "issued_at", nullable = false)
    private Instant issuedAt;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20)
    private CertificateStatus status;

    public Long getId() { return id; }
    public String getCertificateId() { return certificateId; }
    public void setCertificateId(String certificateId) { this.certificateId = certificateId; }
    public EventRegistration getRegistration() { return registration; }
    public void setRegistration(EventRegistration registration) { this.registration = registration; }
    public Instant getIssuedAt() { return issuedAt; }
    public void setIssuedAt(Instant issuedAt) { this.issuedAt = issuedAt; }
    public CertificateStatus getStatus() { return status; }
    public void setStatus(CertificateStatus status) { this.status = status; }
}
