package org.eventproof.scanner;

import org.eventproof.attendance.Attendance;
import org.eventproof.attendance.AttendanceRepository;
import org.eventproof.attendance.AttendanceService;
import org.eventproof.common.DomainEnums.AttendanceSource;
import org.eventproof.common.SignatureService;
import org.eventproof.event.EventRegistration;
import org.eventproof.event.EventRegistrationRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class ScannerService {
    private final ScannerDeviceRepository scanners;
    private final EventRegistrationRepository registrations;
    private final AttendanceRepository attendance;
    private final AttendanceService attendanceService;
    private final SignatureService signatures;

    public ScannerService(ScannerDeviceRepository scanners, EventRegistrationRepository registrations,
                          AttendanceRepository attendance, AttendanceService attendanceService, SignatureService signatures) {
        this.scanners = scanners;
        this.registrations = registrations;
        this.attendance = attendance;
        this.attendanceService = attendanceService;
        this.signatures = signatures;
    }

    @Transactional
    public PairResult pair(String pairingToken) {
        ScannerDevice scanner = scanners.findByPairingToken(pairingToken)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Pairing code not found"));
        if (scanner.getDeviceId() == null || scanner.getDeviceId().isBlank()) {
            scanner.setDeviceId(UUID.randomUUID().toString());
        }
        scanner.setPaired(true);
        scanner.setPairedAt(Instant.now());
        scanners.save(scanner);
        return new PairResult(scanner.getDeviceId(), contextFor(scanner));
    }

    @Transactional(readOnly = true)
    public ScannerContext context(String deviceId) {
        return contextFor(requireDevice(deviceId));
    }

    @Transactional(readOnly = true)
    public ParticipantView resolve(String deviceId, String qrToken) {
        ScannerDevice scanner = requireDevice(deviceId);
        if (qrToken == null || qrToken.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Scan or enter a QR token first");
        }
        String token = qrToken.trim();

        // 1. Detect if the user accidentally scanned a scanner pairing token or pairing URL
        if (token.contains("pair=") || token.contains("/scanner.html") || scanners.findByPairingToken(token).isPresent()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Scanned code is a scanner pairing code, not a student attendance pass");
        }

        EventRegistration registration = null;

        // 2. Try cryptographic registration token (EP1.<credential>.<signature>)
        if (token.startsWith("EP1.")) {
            String credential = signatures.extractRegistrationCredential(token);
            if (credential != null) {
                registration = registrations.findByCredentialToken(credential).orElse(null);
            }
        }

        // 3. Try direct credential token match (e.g. EP-CRED-... or raw UUID)
        if (registration == null) {
            registration = registrations.findByCredentialToken(token).orElse(null);
        }

        // 4. Try student number match within the scanner's event (e.g. "2024-01-07404")
        if (registration == null) {
            String studentNum = token.toLowerCase(Locale.ROOT);
            registration = registrations.findByEventIdOrderByStudentFullNameAsc(scanner.getEvent().getId()).stream()
                    .filter(r -> r.getStudent().getStudentNumber().toLowerCase(Locale.ROOT).equals(studentNum))
                    .findFirst()
                    .orElse(null);
        }

        if (registration == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid QR credential: not a recognized EventProof participant pass");
        }

        if (!registration.getEvent().getId().equals(scanner.getEvent().getId())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Participant is registered for a different event: '" + registration.getEvent().getName() + "'");
        }

        Attendance row = attendance.findByEventIdAndRegistrationId(scanner.getEvent().getId(), registration.getId()).orElse(null);
        return participantView(registration, row);
    }

    @Transactional(readOnly = true)
    public List<ParticipantView> find(String deviceId, String query) {
        ScannerDevice scanner = requireDevice(deviceId);
        String needle = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
        if (needle.isBlank()) return List.of();
        Map<Long, Attendance> present = attendance.findByEventId(scanner.getEvent().getId()).stream()
                .collect(Collectors.toMap(a -> a.getRegistration().getId(), Function.identity()));
        return registrations.findByEventIdOrderByStudentFullNameAsc(scanner.getEvent().getId()).stream()
                .filter(r -> r.getStudent().getStudentNumber().toLowerCase(Locale.ROOT).contains(needle)
                        || r.getStudent().getFullName().toLowerCase(Locale.ROOT).contains(needle))
                .limit(20)
                .map(r -> participantView(r, present.get(r.getId())))
                .toList();
    }

    @Transactional
    public AttendanceService.Result confirm(String deviceId, Long registrationId, String clientTransactionId, Instant capturedAt, AttendanceSource source) {
        ScannerDevice scanner = requireDevice(deviceId);
        return attendanceService.confirm(scanner, registrationId, clientTransactionId, capturedAt, source == null ? AttendanceSource.ONLINE : source);
    }

    @Transactional
    public List<AttendanceService.Result> sync(String deviceId, List<SyncItem> items) {
        ScannerDevice scanner = requireDevice(deviceId);
        List<AttendanceService.Result> results = new ArrayList<>();
        if (items == null) return results;
        for (SyncItem item : items) {
            results.add(attendanceService.confirm(scanner, item.registrationId(), item.clientTransactionId(), item.capturedAt(), AttendanceSource.OFFLINE));
        }
        return results;
    }

    private ScannerDevice requireDevice(String deviceId) {
        if (deviceId == null || deviceId.isBlank()) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Scanner device is not paired");
        return scanners.findByDeviceIdAndPairedTrue(deviceId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Scanner device is not authorized"));
    }

    private ScannerContext contextFor(ScannerDevice scanner) {
        Long eventId = scanner.getEvent().getId();
        Map<Long, Attendance> present = attendance.findByEventId(eventId).stream()
                .collect(Collectors.toMap(a -> a.getRegistration().getId(), Function.identity()));
        List<RosterItem> roster = registrations.findByEventIdOrderByStudentFullNameAsc(eventId).stream().map(r -> {
            Attendance a = present.get(r.getId());
            return new RosterItem(r.getId(), r.getStudent().getStudentNumber(), r.getStudent().getFullName(), r.getStudent().getProgram(),
                    signatures.registrationQrToken(r.getCredentialToken()), a != null, a == null ? null : a.getCheckedInAt(),
                    a == null ? null : a.getLoggedOutAt(), a == null || a.getScannerDevice() == null ? null : a.getScannerDevice().getScannerName());
        }).toList();
        return new ScannerContext(scanner.getId(), scanner.getScannerName(), scanner.getEvent().getId(), scanner.getEvent().getName(),
                scanner.getEvent().getVenue(), scanner.getEvent().getEventDate().toString(), scanner.getEvent().getAttendanceType(), roster);
    }

    private ParticipantView participantView(EventRegistration r, Attendance a) {
        return new ParticipantView(r.getId(), r.getStudent().getStudentNumber(), r.getStudent().getFullName(), r.getStudent().getProgram(), true,
                a != null, a == null ? null : a.getCheckedInAt(), a == null ? null : a.getLoggedOutAt(),
                a == null || a.getScannerDevice() == null ? null : a.getScannerDevice().getScannerName(), r.getEvent().getAttendanceType());
    }

    public record PairResult(String deviceId, ScannerContext context) {}
    public record ScannerContext(Long scannerId, String scannerName, Long eventId, String eventName, String venue, String eventDate, String attendanceType, List<RosterItem> roster) {}
    public record RosterItem(Long registrationId, String studentNumber, String fullName, String program, String qrToken,
                             boolean present, Instant checkedInAt, Instant loggedOutAt, String scannerName) {}
    public record ParticipantView(Long registrationId, String studentNumber, String fullName, String program, boolean registered,
                                  boolean present, Instant checkedInAt, Instant loggedOutAt, String scannerName, String attendanceType) {}
    public record SyncItem(Long registrationId, String clientTransactionId, Instant capturedAt) {}
}
