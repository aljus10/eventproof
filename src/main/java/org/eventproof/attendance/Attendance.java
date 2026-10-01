package org.eventproof.attendance;

import jakarta.persistence.*;
import org.eventproof.common.DomainEnums.AttendanceSource;
import org.eventproof.event.Event;
import org.eventproof.event.EventRegistration;
import org.eventproof.scanner.ScannerDevice;
import java.time.Instant;

@Entity
@Table(name = "attendance", uniqueConstraints = @UniqueConstraint(columnNames = {"event_id", "registration_id"}))
public class Attendance {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "event_id", nullable = false)
    private Event event;
    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "registration_id", nullable = false)
    private EventRegistration registration;
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "scanner_device_id")
    private ScannerDevice scannerDevice;
    @Column(name = "checked_in_at", nullable = false)
    private Instant checkedInAt;
    @Column(name = "logged_out_at")
    private Instant loggedOutAt;
    @Column(name = "synced_at", nullable = false)
    private Instant syncedAt;
    @Column(name = "client_transaction_id", nullable = false, unique = true, length = 100)
    private String clientTransactionId;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20)
    private AttendanceSource source;

    public Long getId() { return id; }
    public Event getEvent() { return event; }
    public void setEvent(Event event) { this.event = event; }
    public EventRegistration getRegistration() { return registration; }
    public void setRegistration(EventRegistration registration) { this.registration = registration; }
    public ScannerDevice getScannerDevice() { return scannerDevice; }
    public void setScannerDevice(ScannerDevice scannerDevice) { this.scannerDevice = scannerDevice; }
    public Instant getCheckedInAt() { return checkedInAt; }
    public void setCheckedInAt(Instant checkedInAt) { this.checkedInAt = checkedInAt; }
    public Instant getLoggedOutAt() { return loggedOutAt; }
    public void setLoggedOutAt(Instant loggedOutAt) { this.loggedOutAt = loggedOutAt; }
    public Instant getSyncedAt() { return syncedAt; }
    public void setSyncedAt(Instant syncedAt) { this.syncedAt = syncedAt; }
    public String getClientTransactionId() { return clientTransactionId; }
    public void setClientTransactionId(String clientTransactionId) { this.clientTransactionId = clientTransactionId; }
    public AttendanceSource getSource() { return source; }
    public void setSource(AttendanceSource source) { this.source = source; }
}
