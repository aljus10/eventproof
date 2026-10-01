package org.eventproof.attendance;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface AttendanceRepository extends JpaRepository<Attendance, Long> {
    Optional<Attendance> findByEventIdAndRegistrationId(Long eventId, Long registrationId);
    Optional<Attendance> findByClientTransactionId(String clientTransactionId);
    List<Attendance> findByEventId(Long eventId);
    List<Attendance> findByScannerDeviceId(Long scannerDeviceId);
    long countByEventId(Long eventId);
}
