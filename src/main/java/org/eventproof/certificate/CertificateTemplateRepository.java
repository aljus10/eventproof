package org.eventproof.certificate;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface CertificateTemplateRepository extends JpaRepository<CertificateTemplate, Long> {
    Optional<CertificateTemplate> findByEventId(Long eventId);
    Optional<CertificateTemplate> findFirstByIsDefaultTrue();
    List<CertificateTemplate> findAllByOrderByCreatedAtDesc();
}
