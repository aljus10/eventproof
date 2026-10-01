package org.eventproof.scanner;

import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface ScannerDeviceRepository extends JpaRepository<ScannerDevice, Long> {
    List<ScannerDevice> findByEventIdOrderByScannerNameAsc(Long eventId);
    Optional<ScannerDevice> findByPairingToken(String pairingToken);
    Optional<ScannerDevice> findByDeviceIdAndPairedTrue(String deviceId);
}
