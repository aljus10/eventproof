package org.eventproof.scanner;

import org.eventproof.attendance.AttendanceService;
import org.eventproof.common.DomainEnums.AttendanceSource;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;

@RestController
@RequestMapping("/api/scanner")
public class ScannerController {
    private final ScannerService service;

    public ScannerController(ScannerService service) { this.service = service; }

    @PostMapping("/pair")
    public ScannerService.PairResult pair(@RequestBody PairRequest request) { return service.pair(request.pairingToken()); }

    @GetMapping("/context")
    public ScannerService.ScannerContext context(@RequestHeader("X-Scanner-Device") String deviceId) { return service.context(deviceId); }

    @PostMapping("/resolve")
    public ScannerService.ParticipantView resolve(@RequestHeader("X-Scanner-Device") String deviceId, @RequestBody ResolveRequest request) {
        return service.resolve(deviceId, request.qrToken());
    }

    @GetMapping("/find")
    public List<ScannerService.ParticipantView> find(@RequestHeader("X-Scanner-Device") String deviceId, @RequestParam("q") String query) {
        return service.find(deviceId, query);
    }

    @PostMapping("/confirm")
    public AttendanceService.Result confirm(@RequestHeader("X-Scanner-Device") String deviceId, @RequestBody ConfirmRequest request) {
        return service.confirm(deviceId, request.registrationId(), request.clientTransactionId(), request.capturedAt(), request.source());
    }

    @PostMapping("/sync")
    public List<AttendanceService.Result> sync(@RequestHeader("X-Scanner-Device") String deviceId, @RequestBody SyncRequest request) {
        return service.sync(deviceId, request.items());
    }

    public record PairRequest(String pairingToken) {}
    public record ResolveRequest(String qrToken) {}
    public record ConfirmRequest(Long registrationId, String clientTransactionId, Instant capturedAt, AttendanceSource source) {}
    public record SyncRequest(List<ScannerService.SyncItem> items) {}
}
