package org.eventproof;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.eventproof.attendance.AttendanceRepository;
import org.eventproof.event.EventRegistrationRepository;
import org.eventproof.student.StudentRepository;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class EventProofIntegrationTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired StudentRepository students;
    @Autowired EventRegistrationRepository registrations;
    @Autowired AttendanceRepository attendance;

    Long eventId;
    Long juanStudentId;
    Long mariaStudentId;
    Long carloStudentId;
    Long juanRegistrationId;
    Long mariaRegistrationId;
    Long carloRegistrationId;
    String juanQr;
    String deviceId;
    String certificateId;
    String verificationToken;

    @BeforeAll
    void lookupSeedStudents() {
        juanStudentId = students.findByStudentNumber("2024-01-07404").orElseThrow().getId();
        mariaStudentId = students.findByStudentNumber("2024-01-12313").orElseThrow().getId();
        carloStudentId = students.findByStudentNumber("2024-01-18014").orElseThrow().getId();
    }

    @Test @Order(1)
    void authenticationUsesSeededDemoAccountAndRoleRedirect() throws Exception {
        mvc.perform(post("/login").param("username", "eventmanager").param("password", "demo123"))
                .andExpect(status().is3xxRedirection())
                .andExpect(redirectedUrl("/manager.html"));
    }

    @Test @Order(2) @WithMockUser(username="sysadmin", roles="SYSTEM_ADMIN")
    void roleRestrictionBlocksAdminFromManagerApi() throws Exception {
        mvc.perform(get("/api/manager/events")).andExpect(status().isForbidden());
    }

    @Test @Order(3) @WithMockUser(username="eventmanager", roles="EVENT_MANAGER")
    void eventCreationAndRegistrationWork() throws Exception {
        String eventBody = """
                {"name":"Integration Test Seminar","eventDate":"2026-10-01","startTime":"09:00","endTime":"12:00","venue":"BU Polangui Campus"}
                """;
        MvcResult created = mvc.perform(post("/api/manager/events").contentType(MediaType.APPLICATION_JSON).content(eventBody))
                .andExpect(status().isCreated()).andReturn();
        eventId = json.readTree(created.getResponse().getContentAsString()).get("id").asLong();

        juanRegistrationId = register(juanStudentId);
        mariaRegistrationId = register(mariaStudentId);
        carloRegistrationId = register(carloStudentId);

        MvcResult rows = mvc.perform(get("/api/manager/events/{id}/registrations", eventId))
                .andExpect(status().isOk()).andReturn();
        List<Map<String,Object>> list = json.readValue(rows.getResponse().getContentAsString(), new TypeReference<>() {});
        assertThat(list).hasSize(3);
        Map<String,Object> juan = list.stream().filter(x -> "2024-01-07404".equals(x.get("studentNumber"))).findFirst().orElseThrow();
        juanQr = String.valueOf(juan.get("qrToken"));
        assertThat(juanQr).startsWith("EP1.");

        mvc.perform(get("/api/manager/registrations/{id}/qr", juanRegistrationId))
                .andExpect(status().isOk()).andExpect(content().contentType(MediaType.IMAGE_PNG));
    }

    private Long register(Long studentId) throws Exception {
        MvcResult r = mvc.perform(post("/api/manager/events/{id}/registrations", eventId)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"studentId\":" + studentId + "}"))
                .andExpect(status().isOk()).andReturn();
        return json.readTree(r.getResponse().getContentAsString()).get("id").asLong();
    }

    @Test @Order(4) @WithMockUser(username="eventmanager", roles="EVENT_MANAGER")
    void scannerCanBeCreatedForEvent() throws Exception {
        MvcResult r = mvc.perform(post("/api/manager/events/{id}/scanners", eventId)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"scannerName\":\"Entrance A\"}"))
                .andExpect(status().isOk()).andReturn();
        JsonNode node = json.readTree(r.getResponse().getContentAsString());
        String pairingToken = node.get("pairingToken").asText();
        assertThat(pairingToken).isNotBlank();

        MvcResult paired = mvc.perform(post("/api/scanner/pair").with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user("scanner").roles("SCANNER"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"pairingToken\":\"" + pairingToken + "\"}"))
                .andExpect(status().isOk()).andReturn();
        deviceId = json.readTree(paired.getResponse().getContentAsString()).get("deviceId").asText();
        assertThat(deviceId).isNotBlank();
    }

    @Test @Order(5) @WithMockUser(username="scanner", roles="SCANNER")
    void qrResolutionShowsIdentityButDoesNotRecordAttendance() throws Exception {
        mvc.perform(post("/api/scanner/resolve").header("X-Scanner-Device", deviceId)
                        .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(Map.of("qrToken", juanQr))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.studentNumber").value("2024-01-07404"))
                .andExpect(jsonPath("$.present").value(false));
        assertThat(attendance.findByEventIdAndRegistrationId(eventId, juanRegistrationId)).isEmpty();
    }

    @Test @Order(6) @WithMockUser(username="scanner", roles="SCANNER")
    void explicitConfirmationRecordsOnceAndRejectsCanonicalDuplicate() throws Exception {
        String captured = "2026-09-19T06:31:00Z";
        MvcResult first = mvc.perform(post("/api/scanner/confirm").header("X-Scanner-Device", deviceId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("registrationId", juanRegistrationId, "clientTransactionId", "tx-juan-1", "capturedAt", captured, "source", "ONLINE"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.created").value(true)).andReturn();
        assertThat(json.readTree(first.getResponse().getContentAsString()).get("checkedInAt").asText()).isEqualTo(captured);

        mvc.perform(post("/api/scanner/confirm").header("X-Scanner-Device", deviceId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of("registrationId", juanRegistrationId, "clientTransactionId", "tx-juan-2", "capturedAt", "2026-09-19T06:40:00Z", "source", "ONLINE"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.created").value(false))
                .andExpect(jsonPath("$.checkedInAt").value(captured));
        assertThat(attendance.findByEventId(eventId)).hasSize(1);
    }

    @Test @Order(7) @WithMockUser(username="scanner", roles="SCANNER")
    void offlineSyncPreservesCapturedAtAndIsIdempotent() throws Exception {
        String captured = "2026-09-19T06:35:00Z";
        String body = json.writeValueAsString(Map.of("items", List.of(Map.of("registrationId", mariaRegistrationId,
                "clientTransactionId", "offline-maria-1", "capturedAt", captured))));
        mvc.perform(post("/api/scanner/sync").header("X-Scanner-Device", deviceId).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].created").value(true)).andExpect(jsonPath("$[0].checkedInAt").value(captured));
        mvc.perform(post("/api/scanner/sync").header("X-Scanner-Device", deviceId).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isOk()).andExpect(jsonPath("$[0].created").value(false));
        var row = attendance.findByClientTransactionId("offline-maria-1").orElseThrow();
        assertThat(row.getCheckedInAt()).isEqualTo(Instant.parse(captured));
        assertThat(row.getSyncedAt()).isAfterOrEqualTo(row.getCheckedInAt());
        assertThat(attendance.findByEventId(eventId)).hasSize(2);
    }

    @Test @Order(8) @WithMockUser(username="sysadmin", roles="SYSTEM_ADMIN")
    void certificateEligibilityMatchesRegisteredPlusPresent() throws Exception {
        MvcResult r = mvc.perform(get("/api/admin/events/{id}/eligibility", eventId)).andExpect(status().isOk()).andReturn();
        List<Map<String,Object>> rows = json.readValue(r.getResponse().getContentAsString(), new TypeReference<>() {});
        assertThat(rows.stream().filter(x -> "2024-01-07404".equals(x.get("studentNumber"))).findFirst().orElseThrow().get("eligibility")).isEqualTo("Eligible");
        assertThat(rows.stream().filter(x -> "2024-01-12313".equals(x.get("studentNumber"))).findFirst().orElseThrow().get("eligibility")).isEqualTo("Eligible");
        assertThat(rows.stream().filter(x -> "2024-01-18014".equals(x.get("studentNumber"))).findFirst().orElseThrow().get("eligibility")).isEqualTo("Absent");

        mvc.perform(post("/api/admin/certificates/generate").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"registrationId\":" + carloRegistrationId + "}"))
                .andExpect(status().isBadRequest());
    }

    @Test @Order(9) @WithMockUser(username="sysadmin", roles="SYSTEM_ADMIN")
    void certificateGenerationProducesPdfAndSignedVerification() throws Exception {
        MvcResult generated = mvc.perform(post("/api/admin/certificates/generate").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"registrationId\":" + juanRegistrationId + "}"))
                .andExpect(status().isOk()).andReturn();
        JsonNode c = json.readTree(generated.getResponse().getContentAsString());
        certificateId = c.get("certificateId").asText();
        verificationToken = c.get("verificationToken").asText();
        assertThat(certificateId).startsWith("EP-");

        MvcResult pdf = mvc.perform(get("/api/admin/certificates/{id}/pdf", certificateId))
                .andExpect(status().isOk()).andExpect(content().contentType(MediaType.APPLICATION_PDF)).andReturn();
        byte[] bytes = pdf.getResponse().getContentAsByteArray();
        assertThat(bytes.length).isGreaterThan(1000);
        assertThat(new String(bytes, 0, 4, StandardCharsets.US_ASCII)).isEqualTo("%PDF");

        mvc.perform(get("/api/verify/{id}", certificateId).param("token", verificationToken)
                        .with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.anonymous()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("VALID"))
                .andExpect(jsonPath("$.participant").value("Juan A. Dela Cruz"));
        mvc.perform(get("/api/verify/{id}", certificateId).param("token", "bad-token")
                        .with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.anonymous()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("INVALID"));
    }

    @Test @Order(10) @WithMockUser(username="sysadmin", roles="SYSTEM_ADMIN")
    void revokedCertificateVerifiesAsRevoked() throws Exception {
        mvc.perform(post("/api/admin/certificates/{id}/revoke", certificateId))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("REVOKED"));
        mvc.perform(get("/api/verify/{id}", certificateId).param("token", verificationToken)
                        .with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.anonymous()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("REVOKED"));
    }

    @Test @Order(11) @WithMockUser(username="sysadmin", roles="SYSTEM_ADMIN")
    void unrevokedCertificateRestoresValidStatusAndBulkOperationsWork() throws Exception {
        mvc.perform(post("/api/admin/certificates/{id}/unrevoke", certificateId))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("VALID"));
        mvc.perform(get("/api/verify/{id}", certificateId).param("token", verificationToken)
                        .with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.anonymous()))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("VALID"));

        mvc.perform(get("/api/admin/events/{id}/certificates/zip", eventId))
                .andExpect(status().isOk())
                .andExpect(content().contentType("application/zip"));

        mvc.perform(get("/api/admin/templates"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].name").value("Default Institutional Certificate"));
    }

    @Test @Order(12) @WithMockUser(username="sysadmin", roles="SYSTEM_ADMIN")
    void templateCoordinatesAreUprightAndSamplePdfWorks() throws Exception {
        MvcResult templatesRes = mvc.perform(get("/api/admin/templates"))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode list = json.readTree(templatesRes.getResponse().getContentAsString());
        assertThat(list.isArray()).isTrue();
        JsonNode defaultTemplate = list.get(0);
        JsonNode layout = json.readTree(defaultTemplate.get("layoutJson").asText());
        JsonNode elements = layout.get("elements");

        // Verify crest is at the top (Y < 100) and signatures are at the bottom (Y > 400)
        boolean crestAtTop = false;
        boolean signaturesAtBottom = false;
        for (JsonNode el : elements) {
            String label = el.path("label").asText();
            double y = el.path("y").asDouble();
            if ("EMBLEM_CREST".equals(label)) {
                assertThat(y).isLessThan(100.0);
                crestAtTop = true;
            }
            if ("SIGNATORY_1".equals(label) || "SIGNATORY_2".equals(label)) {
                assertThat(y).isGreaterThan(400.0);
                signaturesAtBottom = true;
            }
        }
        assertThat(crestAtTop).isTrue();
        assertThat(signaturesAtBottom).isTrue();

        // Sample PDF generation
        MvcResult sampleRes = mvc.perform(post("/api/admin/templates/sample-pdf")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"layoutJson\":" + json.writeValueAsString(defaultTemplate.get("layoutJson").asText()) + "}"))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.APPLICATION_PDF))
                .andReturn();
        byte[] pdfBytes = sampleRes.getResponse().getContentAsByteArray();
        assertThat(pdfBytes.length).isGreaterThan(1000);
        assertThat(new String(pdfBytes, 0, 4, StandardCharsets.US_ASCII)).isEqualTo("%PDF");
    }

    @Test @Order(13) @WithMockUser(username="sysadmin", roles="SYSTEM_ADMIN")
    void templateBackgroundUploadAndCustomRendering() throws Exception {
        MvcResult templatesRes = mvc.perform(get("/api/admin/templates"))
                .andExpect(status().isOk())
                .andReturn();
        Long templateId = json.readTree(templatesRes.getResponse().getContentAsString()).get(0).get("id").asLong();

        // 1x1 PNG image
        byte[] fakePng = new byte[]{(byte) 137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, -60, -119, 0, 0, 0, 10, 73, 68, 65, 84, 120, -100, 99, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, -76, 0, 0, 0, 0, 73, 69, 78, 68, -82, 66, 96, -126};
        org.springframework.mock.web.MockMultipartFile file = new org.springframework.mock.web.MockMultipartFile("file", "bg.png", "image/png", fakePng);

        MvcResult uploadRes = mvc.perform(multipart("/api/admin/templates/{id}/background", templateId).file(file))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.backgroundImage").isNotEmpty())
                .andReturn();

        String bgUrl = json.readTree(uploadRes.getResponse().getContentAsString()).get("backgroundImage").asText();
        assertThat(bgUrl).startsWith("data:image/png;base64,");

        // Verify sample PDF with background
        mvc.perform(post("/api/admin/templates/sample-pdf")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"layoutJson\":\"{}\",\"backgroundImage\":\"" + bgUrl + "\"}"))
                .andExpect(status().isOk())
                .andExpect(content().contentType(MediaType.APPLICATION_PDF));
    }

    @Test @Order(14) @WithMockUser(username="eventmanager", roles="EVENT_MANAGER")
    void wizardCreationAndUnpresentWork() throws Exception {
        // 1. Create event with wizard payload (organizer, description, studentIds, scannerName)
        String wizardPayload = """
                {
                    "name": "Wizard Institutional Forum",
                    "eventDate": "2026-10-15",
                    "startTime": "13:00",
                    "endTime": "17:00",
                    "venue": "Bicol University Auditorium",
                    "organizer": "College of Science - CS Dept",
                    "description": "Annual Technology Summit for BSCS students",
                    "studentIds": [%d, %d],
                    "scannerName": "Door 1 Primary Scanner"
                }
                """.formatted(juanStudentId, mariaStudentId);

        MvcResult createRes = mvc.perform(post("/api/manager/events")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(wizardPayload))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.organizer").value("College of Science - CS Dept"))
                .andExpect(jsonPath("$.description").value("Annual Technology Summit for BSCS students"))
                .andReturn();

        long newEventId = json.readTree(createRes.getResponse().getContentAsString()).get("id").asLong();

        // Verify registrations were batch created
        MvcResult regsRes = mvc.perform(get("/api/manager/events/{id}/registrations", newEventId))
                .andExpect(status().isOk()).andReturn();
        List<Map<String, Object>> regs = json.readValue(regsRes.getResponse().getContentAsString(), new TypeReference<>() {});
        assertThat(regs).hasSize(2);
        long juanRegId = ((Number) regs.get(0).get("id")).longValue();

        // Verify scanner was provisioned
        MvcResult scannersRes = mvc.perform(get("/api/manager/events/{id}/scanners", newEventId))
                .andExpect(status().isOk()).andReturn();
        List<Map<String, Object>> scanners = json.readValue(scannersRes.getResponse().getContentAsString(), new TypeReference<>() {});
        assertThat(scanners).hasSize(1);
        assertThat(scanners.get(0).get("scannerName")).isEqualTo("Door 1 Primary Scanner");

        // 2. Pair scanner and record attendance
        String token = (String) scanners.get(0).get("pairingToken");
        MvcResult paired = mvc.perform(post("/api/scanner/pair")
                        .with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user("scanner").roles("SCANNER"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"pairingToken\":\"" + token + "\"}"))
                .andExpect(status().isOk()).andReturn();
        String devId = json.readTree(paired.getResponse().getContentAsString()).get("deviceId").asText();

        mvc.perform(post("/api/scanner/confirm")
                        .with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user("scanner").roles("SCANNER"))
                        .header("X-Scanner-Device", devId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of(
                                "registrationId", juanRegId,
                                "clientTransactionId", "tx-wiz-juan-1",
                                "capturedAt", "2026-10-15T13:30:00Z",
                                "source", "ONLINE"
                        ))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.created").value(true));

        // Verify attendance exists and juan is present
        MvcResult attRes = mvc.perform(get("/api/manager/events/{id}/attendance", newEventId))
                .andExpect(status().isOk()).andReturn();
        List<Map<String, Object>> attList = json.readValue(attRes.getResponse().getContentAsString(), new TypeReference<>() {});
        assertThat(attList).hasSize(2);
        Map<String, Object> juanAtt = attList.stream().filter(a -> ((Number) a.get("id")).longValue() == juanRegId).findFirst().orElseThrow();
        assertThat(juanAtt.get("present")).isEqualTo(true);
        assertThat(attendance.findByEventId(newEventId)).hasSize(1);

        // 3. Manager unpresents the attendee
        mvc.perform(post("/api/manager/events/{eventId}/registrations/{registrationId}/unpresent", newEventId, juanRegId))
                .andExpect(status().isNoContent());

        // Verify attendee is now absent
        MvcResult attAfter = mvc.perform(get("/api/manager/events/{id}/attendance", newEventId))
                .andExpect(status().isOk()).andReturn();
        List<Map<String, Object>> attListAfter = json.readValue(attAfter.getResponse().getContentAsString(), new TypeReference<>() {});
        Map<String, Object> juanAttAfter = attListAfter.stream().filter(a -> ((Number) a.get("id")).longValue() == juanRegId).findFirst().orElseThrow();
        assertThat(juanAttAfter.get("present")).isEqualTo(false);
        assertThat(attendance.findByEventId(newEventId)).isEmpty();
    }

    @Test @Order(15) @WithMockUser(username="eventmanager", roles="EVENT_MANAGER")
    void dualStageAttendanceAndScannerRemovalWork() throws Exception {
        // 1. Create event with attendanceType = "PRESENT_AND_LOGOUT"
        String payload = """
                {
                    "name": "Dual Stage Attendance Seminar",
                    "eventDate": "2026-10-20",
                    "startTime": "08:00",
                    "endTime": "16:00",
                    "venue": "BU Polangui Gymnasium",
                    "organizer": "Student Council",
                    "description": "Full day seminar with check-in and checkout",
                    "attendanceType": "PRESENT_AND_LOGOUT",
                    "studentIds": [%d],
                    "scannerName": "Gym Station 1"
                }
                """.formatted(carloStudentId);

        MvcResult createRes = mvc.perform(post("/api/manager/events")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.attendanceType").value("PRESENT_AND_LOGOUT"))
                .andReturn();

        long dualEventId = json.readTree(createRes.getResponse().getContentAsString()).get("id").asLong();

        // Check registrations
        MvcResult regsRes = mvc.perform(get("/api/manager/events/{id}/registrations", dualEventId))
                .andExpect(status().isOk()).andReturn();
        List<Map<String, Object>> regs = json.readValue(regsRes.getResponse().getContentAsString(), new TypeReference<>() {});
        assertThat(regs).hasSize(1);
        long carloRegId = ((Number) regs.get(0).get("id")).longValue();

        // Get scanner device
        MvcResult scannersRes = mvc.perform(get("/api/manager/events/{id}/scanners", dualEventId))
                .andExpect(status().isOk()).andReturn();
        List<Map<String, Object>> scanners = json.readValue(scannersRes.getResponse().getContentAsString(), new TypeReference<>() {});
        assertThat(scanners).hasSize(1);
        long scannerId = ((Number) scanners.get(0).get("id")).longValue();
        String token = (String) scanners.get(0).get("pairingToken");

        // Pair scanner
        MvcResult paired = mvc.perform(post("/api/scanner/pair")
                        .with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user("scanner").roles("SCANNER"))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"pairingToken\":\"" + token + "\"}"))
                .andExpect(status().isOk()).andReturn();
        String devId = json.readTree(paired.getResponse().getContentAsString()).get("deviceId").asText();

        // Step 1: Scanner confirms check-in (Time-In)
        String timeIn = "2026-10-20T08:05:00Z";
        mvc.perform(post("/api/scanner/confirm")
                        .with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user("scanner").roles("SCANNER"))
                        .header("X-Scanner-Device", devId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of(
                                "registrationId", carloRegId,
                                "clientTransactionId", "tx-dual-in-1",
                                "capturedAt", timeIn,
                                "source", "ONLINE"
                        ))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.created").value(true))
                .andExpect(jsonPath("$.checkedInAt").value(timeIn))
                .andExpect(jsonPath("$.loggedOutAt").isEmpty());

        // Step 2: Scanner confirms logout (Time-Out)
        String timeOut = "2026-10-20T16:02:00Z";
        mvc.perform(post("/api/scanner/confirm")
                        .with(org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user("scanner").roles("SCANNER"))
                        .header("X-Scanner-Device", devId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json.writeValueAsString(Map.of(
                                "registrationId", carloRegId,
                                "clientTransactionId", "tx-dual-out-1",
                                "capturedAt", timeOut,
                                "source", "ONLINE"
                        ))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.created").value(false))
                .andExpect(jsonPath("$.checkedInAt").value(timeIn))
                .andExpect(jsonPath("$.loggedOutAt").value(timeOut));

        // Verify attendance record in manager view
        MvcResult attRes = mvc.perform(get("/api/manager/events/{id}/attendance", dualEventId))
                .andExpect(status().isOk()).andReturn();
        List<Map<String, Object>> attList = json.readValue(attRes.getResponse().getContentAsString(), new TypeReference<>() {});
        assertThat(attList).hasSize(1);
        assertThat(attList.get(0).get("checkedInAt")).isEqualTo(timeIn);
        assertThat(attList.get(0).get("loggedOutAt")).isEqualTo(timeOut);

        // Step 3: Delete scanner device
        mvc.perform(delete("/api/manager/events/{eventId}/scanners/{scannerId}", dualEventId, scannerId))
                .andExpect(status().isNoContent());

        // Verify scanner is gone
        MvcResult scannersAfter = mvc.perform(get("/api/manager/events/{id}/scanners", dualEventId))
                .andExpect(status().isOk()).andReturn();
        List<Map<String, Object>> scannersListAfter = json.readValue(scannersAfter.getResponse().getContentAsString(), new TypeReference<>() {});
        assertThat(scannersListAfter).isEmpty();

        // Verify attendance record still exists!
        assertThat(attendance.findByEventId(dualEventId)).hasSize(1);
        var attRecord = attendance.findByEventId(dualEventId).get(0);
        assertThat(attRecord.getScannerDevice()).isNull();
        assertThat(attRecord.getCheckedInAt()).isEqualTo(Instant.parse(timeIn));
        assertThat(attRecord.getLoggedOutAt()).isEqualTo(Instant.parse(timeOut));
    }
}


