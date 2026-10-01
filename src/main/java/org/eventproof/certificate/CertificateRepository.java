package org.eventproof.certificate;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface CertificateRepository extends JpaRepository<Certificate, Long> {
    Optional<Certificate> findByCertificateId(String certificateId);
    Optional<Certificate> findByRegistrationId(Long registrationId);
    List<Certificate> findByRegistrationEventId(Long eventId);
}
