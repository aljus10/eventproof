package org.eventproof.scanner;

import jakarta.persistence.*;
import org.eventproof.event.Event;
import java.time.Instant;

@Entity
@Table(name = "scanner_devices")
public class ScannerDevice {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "event_id", nullable = false)
    private Event event;
    @Column(name = "scanner_name", nullable = false, length = 120)
    private String scannerName;
    @Column(name = "pairing_token", nullable = false, unique = true, length = 100)
    private String pairingToken;
    @Column(name = "device_id", unique = true, length = 100)
    private String deviceId;
    @Column(nullable = false)
    private boolean paired;
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;
    @Column(name = "paired_at")
    private Instant pairedAt;

    public Long getId() { return id; }
    public Event getEvent() { return event; }
    public void setEvent(Event event) { this.event = event; }
    public String getScannerName() { return scannerName; }
    public void setScannerName(String scannerName) { this.scannerName = scannerName; }
    public String getPairingToken() { return pairingToken; }
    public void setPairingToken(String pairingToken) { this.pairingToken = pairingToken; }
    public String getDeviceId() { return deviceId; }
    public void setDeviceId(String deviceId) { this.deviceId = deviceId; }
    public boolean isPaired() { return paired; }
    public void setPaired(boolean paired) { this.paired = paired; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Instant getPairedAt() { return pairedAt; }
    public void setPairedAt(Instant pairedAt) { this.pairedAt = pairedAt; }
}
