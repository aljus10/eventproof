package org.eventproof.config;

import org.eventproof.auth.UserAccount;
import org.eventproof.auth.UserAccountRepository;
import org.eventproof.common.DomainEnums.Role;
import org.eventproof.event.Event;
import org.eventproof.event.EventRegistration;
import org.eventproof.event.EventRegistrationRepository;
import org.eventproof.event.EventRepository;
import org.eventproof.student.Student;
import org.eventproof.student.StudentRepository;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

@Component
public class DemoDataInitializer implements ApplicationRunner {
    private final UserAccountRepository users;
    private final EventRepository events;
    private final StudentRepository students;
    private final EventRegistrationRepository registrations;
    private final PasswordEncoder encoder;

    public DemoDataInitializer(UserAccountRepository users, EventRepository events, StudentRepository students,
                               EventRegistrationRepository registrations, PasswordEncoder encoder) {
        this.users = users;
        this.events = events;
        this.students = students;
        this.registrations = registrations;
        this.encoder = encoder;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        seedUser("eventmanager", "demo123", Role.EVENT_MANAGER);
        seedUser("scanner", "demo123", Role.SCANNER);
        seedUser("sysadmin", "demo123", Role.SYSTEM_ADMIN);

        if (events.count() == 0) {
            Event event = new Event();
            event.setName("BSCS Section Colloquium 2026");
            event.setOrganizer("COMSCI Department");
            event.setDescription("Official plenary assembly and academic orientation for BSCS students.");
            event.setEventDate(LocalDate.of(2026, 9, 25));
            event.setStartTime(LocalTime.of(9, 0));
            event.setEndTime(LocalTime.of(17, 0));
            event.setVenue("BU Polangui Campus Auditorium");
            event = events.save(event);

            List<String[]> sample = List.of(
                    new String[]{"2024-01-07404", "Juan A. Dela Cruz", "BSCS"},
                    new String[]{"2024-01-12313", "Maria B. Santos", "BSCS"},
                    new String[]{"2024-01-18014", "Carlo C. Garcia", "BSCS"},
                    new String[]{"2024-01-08064", "Andrea D. Reyes", "BSCS"},
                    new String[]{"2024-01-09718", "Mark E. Ramos", "BSCS"},
                    new String[]{"2024-01-16743", "Liza F. Mendoza", "BSCS"},
                    new String[]{"2024-01-10745", "Paolo G. Bautista", "BSCS"},
                    new String[]{"2024-01-09555", "Diana H. Aquino", "BSCS"},
                    new String[]{"2024-01-07395", "Gabriel I. Cruz", "BSCS"},
                    new String[]{"2024-01-09497", "Patricia J. Flores", "BSCS"},
                    new String[]{"2024-01-06766", "Manuel K. Soriano", "BSCS"},
                    new String[]{"2024-01-07061", "Bea L. Villanueva", "BSCS"},
                    new String[]{"2024-01-12154", "Christian M. Cortez", "BSCS"},
                    new String[]{"2024-01-07884", "Nicole N. Morales", "BSCS"},
                    new String[]{"2024-01-07461", "Angelo O. Valenzuela", "BSCS"},
                    new String[]{"2024-01-06401", "Kristine P. Navarro", "BSCS"},
                    new String[]{"2024-01-05991", "Joshua Q. Castillo", "BSCS"},
                    new String[]{"2024-01-07609", "Camille R. Tolentino", "BSCS"},
                    new String[]{"2024-01-16930", "Kenneth S. Pineda", "BSCS"},
                    new String[]{"2024-01-17707", "Stephanie T. Mercado", "BSCS"},
                    new String[]{"2024-01-07394", "Dominic U. Alcantara", "BSCS"},
                    new String[]{"2024-01-12207", "Janine V. Pascual", "BSCS"},
                    new String[]{"2024-01-09776", "Jerome W. Ocampo", "BSCS"},
                    new String[]{"2024-01-09611", "Kimberly X. Salvador", "BSCS"},
                    new String[]{"2024-01-09548", "Patrick Y. Corpuz", "BSCS"},
                    new String[]{"2024-01-07984", "Katrina Z. Aguilar", "BSCS"},
                    new String[]{"2024-01-01245", "Rafael D. Henson", "BSCS"},
                    new String[]{"2024-01-15090", "Rochelle M. De Leon", "BSCS"},
                    new String[]{"2024-01-09129", "Victor S. Guinto", "BSCS"},
                    new String[]{"2024-01-07945", "Cynthia R. Belmonte", "BSCS"},
                    new String[]{"2024-01-07129", "Danilo T. Macaraeg", "BSCS"},
                    new String[]{"2024-01-00000", "Elena P. Roxas", "BSCS"},
                    new String[]{"2024-01-06701", "Ferdinand G. Romualdez", "BSCS"},
                    new String[]{"2024-01-07427", "Grace J. Laurel", "BSCS"},
                    new String[]{"2024-01-05740", "Henry B. Quezon", "BSCS"},
                    new String[]{"2024-01-07922", "Isabel M. Magsaysay", "BSCS"},
                    new String[]{"2024-01-08122", "Jasmine K. Osmena", "BSCS"},
                    new String[]{"2024-01-19338", "Leo N. Quirino", "BSCS"}
            );
            for (String[] s : sample) {
                Student student = students.findByStudentNumber(s[0]).orElseGet(() -> {
                    Student st = new Student();
                    st.setStudentNumber(s[0]);
                    st.setFullName(s[1]);
                    st.setProgram(s[2]);
                    return students.save(st);
                });

                if (registrations.findByEventIdAndStudentId(event.getId(), student.getId()).isEmpty()) {
                    EventRegistration registration = new EventRegistration();
                    registration.setEvent(event);
                    registration.setStudent(student);
                    registration.setCredentialToken("EP-CRED-" + student.getStudentNumber() + "-" + UUID.randomUUID());
                    registrations.save(registration);
                }
            }
        }
    }

    private void seedUser(String username, String password, Role role) {
        if (users.findByUsername(username).isPresent()) return;
        UserAccount u = new UserAccount();
        u.setUsername(username);
        u.setPasswordHash(encoder.encode(password));
        u.setRole(role);
        u.setEnabled(true);
        users.save(u);
    }
}
