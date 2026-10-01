package org.eventproof.common;

public final class DomainEnums {
    private DomainEnums() {}

    public enum Role {
        EVENT_MANAGER, SCANNER, SYSTEM_ADMIN
    }

    public enum AttendanceSource {
        ONLINE, OFFLINE
    }

    public enum CertificateStatus {
        VALID, REVOKED
    }
}
