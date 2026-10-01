package org.eventproof.config;

import org.eventproof.auth.UserAccountRepository;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;

@Configuration
public class SecurityConfig {
    @Bean
    PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    UserDetailsService userDetailsService(UserAccountRepository users) {
        return username -> users.findByUsername(username)
                .map(u -> User.withUsername(u.getUsername())
                        .password(u.getPasswordHash())
                        .roles(u.getRole().name())
                        .disabled(!u.isEnabled())
                        .build())
                .orElseThrow(() -> new org.springframework.security.core.userdetails.UsernameNotFoundException("User not found"));
    }

    @Bean
    AuthenticationSuccessHandler roleSuccessHandler() {
        return (request, response, authentication) -> {
            boolean admin = authentication.getAuthorities().stream().anyMatch(a -> a.getAuthority().equals("ROLE_SYSTEM_ADMIN"));
            boolean scanner = authentication.getAuthorities().stream().anyMatch(a -> a.getAuthority().equals("ROLE_SCANNER"));
            String pair = request.getParameter("pair");
            if (scanner && pair != null && !pair.isBlank()) {
                response.sendRedirect("/scanner.html?pair=" + java.net.URLEncoder.encode(pair, java.nio.charset.StandardCharsets.UTF_8));
            } else {
                response.sendRedirect(admin ? "/admin.html" : scanner ? "/scanner.html" : "/manager.html");
            }
        };
    }

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, AuthenticationSuccessHandler roleSuccessHandler) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/", "/index.html", "/verify.html", "/css/**", "/js/**", "/api/verify/**", "/error").permitAll()
                .requestMatchers("/manager.html", "/api/manager/**").hasRole("EVENT_MANAGER")
                .requestMatchers("/scanner.html", "/api/scanner/**").hasRole("SCANNER")
                .requestMatchers("/admin.html", "/api/admin/**").hasRole("SYSTEM_ADMIN")
                .anyRequest().authenticated())
            .formLogin(form -> form
                .loginPage("/index.html")
                .loginProcessingUrl("/login")
                .successHandler(roleSuccessHandler)
                .failureUrl("/index.html?error=1")
                .permitAll())
            .logout(logout -> logout.logoutUrl("/logout").logoutSuccessUrl("/index.html?logout=1").permitAll());
        return http.build();
    }
}
