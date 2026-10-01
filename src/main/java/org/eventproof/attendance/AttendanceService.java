package org.eventproof.attendance;

import org.eventproof.common.DomainEnums.AttendanceSource;
import org.eventproof.event.EventRegistration;
import org.eventproof.event.EventRegistrationRepository;
import org.eventproof.scanner.ScannerDevice;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;

@Service
public class AttendanceService {
    private final AttendanceRepository attendance;
    private final EventRegistrationRepository registrations;
    private final AttendanceEvents events;
    private final org.eventproof.certificate.CertificateRepository certificates;

    public AttendanceService(AttendanceRepository attendance, EventRegistrationRepository registrations,
                             AttendanceEvents events, org.eventproof.certificate.CertificateRepository certificates) {
        this.attendance = attendance;
        this.registrations = registrations;
        this.events = events;
        this.certificates = certificates;
    }

    @Transactional
    public void unpresent(Long eventId, Long registrationId) {
        attendance.findByEventIdAndRegistrationId(eventId, registrationId).ifPresent(a -> {
            certificates.findByRegistrationId(registrationId).ifPresent(certificates::delete);
            attendance.delete(a);
            events.attendanceChanged(eventId);
        });
    }

    @Transactional
    public Result logout(Long eventId, Long registrationId) {
        Attendance a = attendance.findByEventIdAndRegistrationId(eventId, registrationId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Attendance record not found"));
        if (a.getLoggedOutAt() == null) {
            a.setLoggedOutAt(Instant.now());
            a.setSyncedAt(Instant.now());
            a = attendance.saveAndFlush(a);
            events.attendanceChanged(eventId);
        }
        return toResult(a, false);
    }

    @Transactional
    public Result confirm(ScannerDevice scanner, Long registrationId, String clientTransactionId,
                          Instant capturedAt, AttendanceSource source) {
        if (clientTransactionId == null || clientTransactionId.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "clientTransactionId is required");
        }
        Attendance existingByTx = attendance.findByClientTransactionId(clientTransactionId).orElse(null);
        if (existingByTx != null) {
            if (!existingByTx.getRegistration().getId().equals(registrationId)) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "clientTransactionId is already used by another attendance transaction");
            }
            return toResult(existingByTx, false);
        }

        EventRegistration registration = registrations.findLockedDetailedById(registrationId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Registration not found"));
        if (!registration.getEvent().getId().equals(scanner.getEvent().getId())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Registration does not belong to scanner event");
        }

        Attendance existing = attendance.findByEventIdAndRegistrationId(scanner.getEvent().getId(), registrationId).orElse(null);
        if (existing != null) {
            // If dual-stage attendance is active and attendee has not logged out yet, record logout!
            if ("PRESENT_AND_LOGOUT".equalsIgnoreCase(registration.getEvent().getAttendanceType()) && existing.getLoggedOutAt() == null) {
                existing.setLoggedOutAt(capturedAt == null ? Instant.now() : capturedAt);
                existing.setSyncedAt(Instant.now());
                existing = attendance.saveAndFlush(existing);
                events.attendanceChanged(scanner.getEvent().getId());
                return toResult(existing, false);
            }
            return toResult(existing, false);
        }

        Attendance row = new Attendance();
        row.setEvent(registration.getEvent());
        row.setRegistration(registration);
        row.setScannerDevice(scanner);
        row.setCheckedInAt(capturedAt == null ? Instant.now() : capturedAt);
        row.setSyncedAt(Instant.now());
        row.setClientTransactionId(clientTransactionId);
        row.setSource(source == null ? AttendanceSource.ONLINE : source);
        row = attendance.saveAndFlush(row);
        events.attendanceChanged(scanner.getEvent().getId());
        return toResult(row, true);
    }

    private Result toResult(Attendance a, boolean created) {
        EventRegistration r = a.getRegistration();
        return new Result(created, r.getId(), r.getStudent().getStudentNumber(), r.getStudent().getFullName(),
                a.getCheckedInAt(), a.getLoggedOutAt(), a.getSyncedAt(),
                a.getScannerDevice() != null ? a.getScannerDevice().getScannerName() : null,
                a.getSource() != null ? a.getSource().name() : null,
                r.getEvent().getAttendanceType());
    }

    public record Result(boolean created, Long registrationId, String studentNumber, String fullName,
                         Instant checkedInAt, Instant loggedOutAt, Instant syncedAt, String scannerName, String source,
                         String attendanceType) {}
}
