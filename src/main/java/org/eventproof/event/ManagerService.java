package org.eventproof.event;

import org.eventproof.attendance.Attendance;
import org.eventproof.attendance.AttendanceRepository;
import org.eventproof.common.SignatureService;
import org.eventproof.scanner.ScannerDevice;
import org.eventproof.scanner.ScannerDeviceRepository;
import org.eventproof.student.Student;
import org.eventproof.student.StudentRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class ManagerService {
    private final EventRepository events;
    private final StudentRepository students;
    private final EventRegistrationRepository registrations;
    private final ScannerDeviceRepository scanners;
    private final AttendanceRepository attendance;
    private final SignatureService signatures;
    private final org.eventproof.attendance.AttendanceService attendanceService;

    public ManagerService(EventRepository events, StudentRepository students, EventRegistrationRepository registrations,
                          ScannerDeviceRepository scanners, AttendanceRepository attendance, SignatureService signatures,
                          org.eventproof.attendance.AttendanceService attendanceService) {
        this.events = events;
        this.students = students;
        this.registrations = registrations;
        this.scanners = scanners;
        this.attendance = attendance;
        this.signatures = signatures;
        this.attendanceService = attendanceService;
    }

    @Transactional(readOnly = true)
    public List<EventView> listEvents() {
        return events.findAll().stream().sorted(Comparator.comparing(Event::getEventDate).reversed()).map(this::eventView).toList();
    }

    @Transactional
    public EventView createEvent(String name, LocalDate date, LocalTime start, LocalTime end, String venue) {
        return createEvent(name, null, null, "PRESENT_ONLY", date, start, end, venue, null, null);
    }

    @Transactional
    public EventView createEvent(String name, String organizer, String description, LocalDate date, LocalTime start, LocalTime end,
                                String venue, List<Long> studentIds, String scannerName) {
        return createEvent(name, organizer, description, "PRESENT_ONLY", date, start, end, venue, studentIds, scannerName);
    }

    @Transactional
    public EventView createEvent(String name, String organizer, String description, String attendanceType, LocalDate date, LocalTime start, LocalTime end,
                                String venue, List<Long> studentIds, String scannerName) {
        if (name == null || name.isBlank() || date == null || start == null || end == null || venue == null || venue.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "All event fields are required");
        }
        if (!end.isAfter(start)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "End time must be after start time");
        Event e = new Event();
        e.setName(name.trim());
        e.setOrganizer(organizer != null && !organizer.isBlank() ? organizer.trim() : null);
        e.setDescription(description != null && !description.isBlank() ? description.trim() : null);
        e.setAttendanceType(attendanceType);
        e.setEventDate(date);
        e.setStartTime(start);
        e.setEndTime(end);
        e.setVenue(venue.trim());
        Event saved = events.save(e);

        if (studentIds != null && !studentIds.isEmpty()) {
            for (Long studentId : studentIds) {
                students.findById(studentId).ifPresent(s -> {
                    if (registrations.findByEventIdAndStudentId(saved.getId(), s.getId()).isEmpty()) {
                        EventRegistration r = new EventRegistration();
                        r.setEvent(saved);
                        r.setStudent(s);
                        r.setCredentialToken(UUID.randomUUID().toString());
                        registrations.save(r);
                    }
                });
            }
        }

        if (scannerName != null && !scannerName.isBlank()) {
            createScanner(saved.getId(), scannerName.trim());
        }

        return eventView(saved);
    }

    @Transactional
    public void unpresent(Long eventId, Long registrationId) {
        attendanceService.unpresent(eventId, registrationId);
    }

    @Transactional
    public void logout(Long eventId, Long registrationId) {
        attendanceService.logout(eventId, registrationId);
    }


    @Transactional(readOnly = true)
    public List<StudentView> listStudents() {
        return students.findAll().stream().sorted(Comparator.comparing(Student::getStudentNumber)).map(this::studentView).toList();
    }

    @Transactional
    public StudentView addStudent(String studentNumber, String fullName, String program) {
        if (studentNumber == null || studentNumber.isBlank() || fullName == null || fullName.isBlank() || program == null || program.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "All student fields are required");
        }
        if (students.findByStudentNumber(studentNumber.trim()).isPresent()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Student number already exists");
        }
        Student s = new Student();
        s.setStudentNumber(studentNumber.trim()); s.setFullName(fullName.trim()); s.setProgram(program.trim());
        return studentView(students.save(s));
    }

    @Transactional
    public RegistrationView registerStudent(Long eventId, Long studentId) {
        Event event = getEvent(eventId);
        Student student = students.findById(studentId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Student not found"));
        EventRegistration existing = registrations.findByEventIdAndStudentId(eventId, studentId).orElse(null);
        if (existing != null) return registrationView(existing, attendance.findByEventIdAndRegistrationId(eventId, existing.getId()).orElse(null));
        EventRegistration r = new EventRegistration();
        r.setEvent(event); r.setStudent(student); r.setCredentialToken(UUID.randomUUID().toString());
        return registrationView(registrations.save(r), null);
    }

    @Transactional(readOnly = true)
    public List<RegistrationView> eventRegistrations(Long eventId) {
        getEvent(eventId);
        Map<Long, Attendance> byRegistration = attendance.findByEventId(eventId).stream()
                .collect(Collectors.toMap(a -> a.getRegistration().getId(), Function.identity()));
        return registrations.findByEventIdOrderByStudentFullNameAsc(eventId).stream()
                .map(r -> registrationView(r, byRegistration.get(r.getId()))).toList();
    }

    @Transactional(readOnly = true)
    public EventRegistration registration(Long registrationId) {
        return registrations.findDetailedById(registrationId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Registration not found"));
    }

    @Transactional
    public ScannerView createScanner(Long eventId, String name) {
        Event event = getEvent(eventId);
        if (name == null || name.isBlank()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Scanner name is required");
        ScannerDevice scanner = new ScannerDevice();
        scanner.setEvent(event); scanner.setScannerName(name.trim()); scanner.setPairingToken(UUID.randomUUID().toString());
        scanner.setPaired(false); scanner.setCreatedAt(Instant.now());
        return scannerView(scanners.save(scanner));
    }

    @Transactional
    public void deleteScanner(Long eventId, Long scannerId) {
        ScannerDevice s = scanner(scannerId);
        if (!s.getEvent().getId().equals(eventId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Scanner does not belong to this event");
        }
        attendance.findByScannerDeviceId(scannerId).forEach(a -> {
            a.setScannerDevice(null);
            attendance.save(a);
        });
        scanners.delete(s);
    }

    @Transactional(readOnly = true)
    public List<ScannerView> scanners(Long eventId) {
        getEvent(eventId);
        return scanners.findByEventIdOrderByScannerNameAsc(eventId).stream().map(this::scannerView).toList();
    }

    @Transactional(readOnly = true)
    public ScannerDevice scanner(Long scannerId) {
        return scanners.findById(scannerId).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Scanner not found"));
    }

    @Transactional(readOnly = true)
    public DashboardView dashboard() {
        long eventCount = events.count();
        long studentCount = students.count();
        long registrationCount = registrations.count();
        long attendanceCount = attendance.count();
        return new DashboardView(eventCount, studentCount, registrationCount, attendanceCount);
    }

    private Event getEvent(Long id) {
        return events.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Event not found"));
    }

    private EventView eventView(Event e) {
        return new EventView(e.getId(), e.getName(), e.getOrganizer(), e.getDescription(), e.getAttendanceType(), e.getEventDate(), e.getStartTime(), e.getEndTime(), e.getVenue(), registrations.countByEventId(e.getId()), attendance.countByEventId(e.getId()));
    }
    private StudentView studentView(Student s) { return new StudentView(s.getId(), s.getStudentNumber(), s.getFullName(), s.getProgram()); }
    private RegistrationView registrationView(EventRegistration r, Attendance a) {
        return new RegistrationView(r.getId(), r.getEvent().getId(), r.getStudent().getId(), r.getStudent().getStudentNumber(), r.getStudent().getFullName(), r.getStudent().getProgram(),
                signatures.registrationQrToken(r.getCredentialToken()), a != null, a == null ? null : a.getCheckedInAt(), a == null ? null : a.getLoggedOutAt(),
                a == null || a.getScannerDevice() == null ? null : a.getScannerDevice().getScannerName(), r.getEvent().getAttendanceType());
    }
    private ScannerView scannerView(ScannerDevice s) { return new ScannerView(s.getId(), s.getEvent().getId(), s.getScannerName(), s.getPairingToken(), s.isPaired(), s.getDeviceId(), s.getCreatedAt(), s.getPairedAt()); }

    public record EventView(Long id, String name, String organizer, String description, String attendanceType, LocalDate eventDate, LocalTime startTime, LocalTime endTime, String venue, long registered, long present) {}
    public record StudentView(Long id, String studentNumber, String fullName, String program) {}
    public record RegistrationView(Long id, Long eventId, Long studentId, String studentNumber, String fullName, String program,
                                   String qrToken, boolean present, Instant checkedInAt, Instant loggedOutAt, String scannerName, String attendanceType) {}
    public record ScannerView(Long id, Long eventId, String scannerName, String pairingToken, boolean paired, String deviceId, Instant createdAt, Instant pairedAt) {}
    public record DashboardView(long events, long students, long registrations, long attendance) {}
}
