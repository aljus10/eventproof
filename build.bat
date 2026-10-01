@echo off
if exist mvnw.cmd (
    call mvnw.cmd package %*
) else (
    mvn package %*
)
