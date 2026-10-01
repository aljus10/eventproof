ALTER TABLE events ADD COLUMN organizer VARCHAR(180);
ALTER TABLE events ADD COLUMN description CLOB;

-- Clean up previous dummy demo students if any exist
DELETE FROM certificates WHERE registration_id IN (
    SELECT r.id FROM event_registrations r
    JOIN students s ON r.student_id = s.id
    WHERE s.student_number LIKE '2026-%'
);

DELETE FROM attendance WHERE registration_id IN (
    SELECT r.id FROM event_registrations r
    JOIN students s ON r.student_id = s.id
    WHERE s.student_number LIKE '2026-%'
);

DELETE FROM event_registrations WHERE student_id IN (
    SELECT id FROM students WHERE student_number LIKE '2026-%'
);

DELETE FROM students WHERE student_number LIKE '2026-%';

-- Insert 38 anonymized sample BSCS students (Real classmate roster kept private in gitignored data/)
INSERT INTO students (student_number, full_name, program) VALUES
('2024-01-07404', 'Juan A. Dela Cruz', 'BSCS'),
('2024-01-12313', 'Maria B. Santos', 'BSCS'),
('2024-01-18014', 'Carlo C. Garcia', 'BSCS'),
('2024-01-08064', 'Andrea D. Reyes', 'BSCS'),
('2024-01-09718', 'Mark E. Ramos', 'BSCS'),
('2024-01-16743', 'Liza F. Mendoza', 'BSCS'),
('2024-01-10745', 'Paolo G. Bautista', 'BSCS'),
('2024-01-09555', 'Diana H. Aquino', 'BSCS'),
('2024-01-07395', 'Gabriel I. Cruz', 'BSCS'),
('2024-01-09497', 'Patricia J. Flores', 'BSCS'),
('2024-01-06766', 'Manuel K. Soriano', 'BSCS'),
('2024-01-07061', 'Bea L. Villanueva', 'BSCS'),
('2024-01-12154', 'Christian M. Cortez', 'BSCS'),
('2024-01-07884', 'Nicole N. Morales', 'BSCS'),
('2024-01-07461', 'Angelo O. Valenzuela', 'BSCS'),
('2024-01-06401', 'Kristine P. Navarro', 'BSCS'),
('2024-01-05991', 'Joshua Q. Castillo', 'BSCS'),
('2024-01-07609', 'Camille R. Tolentino', 'BSCS'),
('2024-01-16930', 'Kenneth S. Pineda', 'BSCS'),
('2024-01-17707', 'Stephanie T. Mercado', 'BSCS'),
('2024-01-07394', 'Dominic U. Alcantara', 'BSCS'),
('2024-01-12207', 'Janine V. Pascual', 'BSCS'),
('2024-01-09776', 'Jerome W. Ocampo', 'BSCS'),
('2024-01-09611', 'Kimberly X. Salvador', 'BSCS'),
('2024-01-09548', 'Patrick Y. Corpuz', 'BSCS'),
('2024-01-07984', 'Katrina Z. Aguilar', 'BSCS'),
('2024-01-01245', 'Rafael D. Henson', 'BSCS'),
('2024-01-15090', 'Rochelle M. De Leon', 'BSCS'),
('2024-01-09129', 'Victor S. Guinto', 'BSCS'),
('2024-01-07945', 'Cynthia R. Belmonte', 'BSCS'),
('2024-01-07129', 'Danilo T. Macaraeg', 'BSCS'),
('2024-01-00000', 'Elena P. Roxas', 'BSCS'),
('2024-01-06701', 'Ferdinand G. Romualdez', 'BSCS'),
('2024-01-07427', 'Grace J. Laurel', 'BSCS'),
('2024-01-05740', 'Henry B. Quezon', 'BSCS'),
('2024-01-07922', 'Isabel M. Magsaysay', 'BSCS'),
('2024-01-08122', 'Jasmine K. Osmena', 'BSCS'),
('2024-01-19338', 'Leo N. Quirino', 'BSCS');

-- If any events exist, ensure the first event registers the 38 students with credentials
INSERT INTO event_registrations (event_id, student_id, credential_token)
SELECT e.id, s.id, 'EP-CRED-' || s.student_number || '-' || RANDOM_UUID()
FROM (SELECT id FROM events ORDER BY id ASC LIMIT 1) e
CROSS JOIN students s
WHERE NOT EXISTS (
    SELECT 1 FROM event_registrations r WHERE r.event_id = e.id AND r.student_id = s.id
);
