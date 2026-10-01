package org.eventproof.student;

import jakarta.persistence.*;

@Entity
@Table(name = "students")
public class Student {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Column(name = "student_number", nullable = false, unique = true, length = 80)
    private String studentNumber;
    @Column(name = "full_name", nullable = false, length = 180)
    private String fullName;
    @Column(nullable = false, length = 80)
    private String program;

    public Long getId() { return id; }
    public String getStudentNumber() { return studentNumber; }
    public void setStudentNumber(String studentNumber) { this.studentNumber = studentNumber; }
    public String getFullName() { return fullName; }
    public void setFullName(String fullName) { this.fullName = fullName; }
    public String getProgram() { return program; }
    public void setProgram(String program) { this.program = program; }
}
