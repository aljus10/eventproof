package org.eventproof.event;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.jpa.repository.Lock;
import jakarta.persistence.LockModeType;
import org.springframework.data.repository.query.Param;
import java.util.List;
import java.util.Optional;

public interface EventRegistrationRepository extends JpaRepository<EventRegistration, Long> {
    List<EventRegistration> findByEventIdOrderByStudentFullNameAsc(Long eventId);
    Optional<EventRegistration> findByEventIdAndStudentId(Long eventId, Long studentId);
    Optional<EventRegistration> findByCredentialToken(String credentialToken);
    long countByEventId(Long eventId);

    @Query("select r from EventRegistration r join fetch r.student join fetch r.event where r.id = :id")
    Optional<EventRegistration> findDetailedById(@Param("id") Long id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select r from EventRegistration r join fetch r.student join fetch r.event where r.id = :id")
    Optional<EventRegistration> findLockedDetailedById(@Param("id") Long id);
}
