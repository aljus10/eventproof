package org.eventproof.event;

import jakarta.servlet.http.HttpServletRequest;
import org.eventproof.attendance.AttendanceEvents;
import org.eventproof.common.QrCodeService;
import org.eventproof.common.SignatureService;
import org.eventproof.scanner.ScannerDevice;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/manager")
public class ManagerController {
    private final ManagerService service;
    private final QrCodeService qr;
    private final SignatureService signatures;
    private final AttendanceEvents attendanceEvents;

    public ManagerController(ManagerService service, QrCodeService qr, SignatureService signatures, AttendanceEvents attendanceEvents) {
        this.service = service; this.qr = qr; this.signatures = signatures; this.attendanceEvents = attendanceEvents;
    }

    @GetMapping("/dashboard")
    public ManagerService.DashboardView dashboard() { return service.dashboard(); }

    @GetMapping("/events")
    public List<ManagerService.EventView> events() { return service.listEvents(); }

    @PostMapping("/events")
    @ResponseStatus(HttpStatus.CREATED)
    public ManagerService.EventView createEvent(@RequestBody EventRequest r) {
        return service.createEvent(r.name(), r.organizer(), r.description(), r.attendanceType(), r.eventDate(), r.startTime(), r.endTime(), r.venue(), r.studentIds(), r.scannerName());
    }

    @PostMapping("/events/{eventId}/registrations/{registrationId}/unpresent")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void unpresent(@PathVariable Long eventId, @PathVariable Long registrationId) {
        service.unpresent(eventId, registrationId);
    }

    @PostMapping("/events/{eventId}/registrations/{registrationId}/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(@PathVariable Long eventId, @PathVariable Long registrationId) {
        service.logout(eventId, registrationId);
    }

    @GetMapping("/students")
    public List<ManagerService.StudentView> students() { return service.listStudents(); }

    @PostMapping("/students")
    @ResponseStatus(HttpStatus.CREATED)
    public ManagerService.StudentView addStudent(@RequestBody StudentRequest r) { return service.addStudent(r.studentNumber(), r.fullName(), r.program()); }

    @PutMapping("/students/{studentId}")
    public ManagerService.StudentView updateStudent(@PathVariable Long studentId, @RequestBody StudentRequest r) {
        return service.updateStudent(studentId, r.studentNumber(), r.fullName(), r.program());
    }

    @GetMapping("/events/{eventId}/registrations")
    public List<ManagerService.RegistrationView> registrations(@PathVariable Long eventId) { return service.eventRegistrations(eventId); }

    @PostMapping("/events/{eventId}/registrations")
    public ManagerService.RegistrationView register(@PathVariable Long eventId, @RequestBody RegisterRequest r) { return service.registerStudent(eventId, r.studentId()); }

    @GetMapping(value = "/registrations/{registrationId}/qr", produces = MediaType.IMAGE_PNG_VALUE)
    public byte[] registrationQr(@PathVariable Long registrationId) {
        EventRegistration r = service.registration(registrationId);
        return qr.png(signatures.registrationQrToken(r.getCredentialToken()), 420);
    }

    @GetMapping(value = "/events/{eventId}/registrations/qr-zip", produces = "application/zip")
    public ResponseEntity<byte[]> batchQrZip(@PathVariable Long eventId) throws java.io.IOException {
        Event event = service.event(eventId);
        List<ManagerService.RegistrationView> regs = service.eventRegistrations(eventId);
        java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
        try (java.util.zip.ZipOutputStream zos = new java.util.zip.ZipOutputStream(baos)) {
            for (ManagerService.RegistrationView r : regs) {
                String safeName = (r.studentNumber() + "_" + r.fullName())
                        .replaceAll("[^a-zA-Z0-9_.-]", "_");
                java.util.zip.ZipEntry entry = new java.util.zip.ZipEntry(safeName + ".png");
                zos.putNextEntry(entry);
                byte[] png = qr.png(r.qrToken(), 420);
                zos.write(png);
                zos.closeEntry();
            }
        }
        String filename = "EventProof-" + event.getName().replaceAll("[^a-zA-Z0-9_.-]", "_") + "-QR-Passes.zip";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .body(baos.toByteArray());
    }

    @GetMapping("/events/{eventId}/attendance")
    public List<ManagerService.RegistrationView> attendance(@PathVariable Long eventId) { return service.eventRegistrations(eventId); }

    @GetMapping(value = "/events/{eventId}/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@PathVariable Long eventId) { return attendanceEvents.subscribe(eventId); }

    @GetMapping("/events/{eventId}/scanners")
    public List<ManagerService.ScannerView> scanners(@PathVariable Long eventId) { return service.scanners(eventId); }

    @PostMapping("/events/{eventId}/scanners")
    public ManagerService.ScannerView createScanner(@PathVariable Long eventId, @RequestBody ScannerRequest r) { return service.createScanner(eventId, r.scannerName()); }

    @DeleteMapping("/events/{eventId}/scanners/{scannerId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteScanner(@PathVariable Long eventId, @PathVariable Long scannerId) {
        service.deleteScanner(eventId, scannerId);
    }

    @GetMapping(value = "/scanners/{scannerId}/pairing-qr", produces = MediaType.IMAGE_PNG_VALUE)
    public byte[] pairingQr(@PathVariable Long scannerId, HttpServletRequest request) {
        ScannerDevice scanner = service.scanner(scannerId);
        String host = resolveHost(request);
        String base = request.getScheme() + "://" + host + ((request.getServerPort() == 80 || request.getServerPort() == 443) ? "" : ":" + request.getServerPort());
        String url = base + "/scanner.html?pair=" + scanner.getPairingToken();
        return qr.png(url, 420);
    }

    @GetMapping("/scanners/{scannerId}/pairing")
    public Map<String, String> pairing(@PathVariable Long scannerId, HttpServletRequest request) {
        ScannerDevice scanner = service.scanner(scannerId);
        String host = resolveHost(request);
        String base = request.getScheme() + "://" + host + ((request.getServerPort() == 80 || request.getServerPort() == 443) ? "" : ":" + request.getServerPort());
        String httpsBase = "https://" + host + ":8443";
        return Map.of(
            "pairingToken", scanner.getPairingToken(),
            "pairingUrl", base + "/scanner.html?pair=" + scanner.getPairingToken(),
            "pairingHttpsUrl", httpsBase + "/scanner.html?pair=" + scanner.getPairingToken()
        );
    }

    private String resolveHost(HttpServletRequest request) {
        String host = request.getServerName();
        if ("localhost".equalsIgnoreCase(host) || "127.0.0.1".equals(host) || "0:0:0:0:0:0:0:1".equals(host)) {
            try {
                String fallback = null;
                java.util.Enumeration<java.net.NetworkInterface> interfaces = java.net.NetworkInterface.getNetworkInterfaces();
                while (interfaces.hasMoreElements()) {
                    java.net.NetworkInterface iface = interfaces.nextElement();
                    if (iface.isLoopback() || !iface.isUp() || iface.isVirtual()) continue;
                    String name = (iface.getName() + " " + iface.getDisplayName()).toLowerCase();
                    boolean isVirtualAdapter = name.contains("virtual") || name.contains("vbox") || name.contains("vmnet") || name.contains("wsl") || name.contains("host-only");
                    java.util.Enumeration<java.net.InetAddress> addresses = iface.getInetAddresses();
                    while (addresses.hasMoreElements()) {
                        java.net.InetAddress addr = addresses.nextElement();
                        if (addr instanceof java.net.Inet4Address && !addr.isLoopbackAddress() && !addr.isLinkLocalAddress()) {
                            String ip = addr.getHostAddress();
                            if (!isVirtualAdapter) {
                                return ip;
                            }
                            if (fallback == null) fallback = ip;
                        }
                    }
                }
                if (fallback != null) return fallback;
            } catch (Exception ignored) {}
        }
        return host;
    }

    public record EventRequest(String name, String organizer, String description, String attendanceType,
                               @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate eventDate,
                               @DateTimeFormat(iso = DateTimeFormat.ISO.TIME) LocalTime startTime,
                               @DateTimeFormat(iso = DateTimeFormat.ISO.TIME) LocalTime endTime,
                               String venue, List<Long> studentIds, String scannerName) {}
    public record StudentRequest(String studentNumber, String fullName, String program) {}
    public record RegisterRequest(Long studentId) {}
    public record ScannerRequest(String scannerName) {}
}
