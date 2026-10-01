package org.eventproof.common;

import jakarta.annotation.PostConstruct;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.util.Set;
import java.security.*;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;

@Service
public class SignatureService {
    private final Path privatePath = Path.of("data", "eventproof-ed25519-private.key");
    private final Path publicPath = Path.of("data", "eventproof-ed25519-public.key");
    private PrivateKey privateKey;
    private PublicKey publicKey;

    @PostConstruct
    public void initialize() throws Exception {
        Files.createDirectories(privatePath.getParent());
        KeyFactory factory = KeyFactory.getInstance("Ed25519");
        if (Files.exists(privatePath) && Files.exists(publicPath)) {
            privateKey = factory.generatePrivate(new PKCS8EncodedKeySpec(Files.readAllBytes(privatePath)));
            publicKey = factory.generatePublic(new X509EncodedKeySpec(Files.readAllBytes(publicPath)));
        } else {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("Ed25519");
            KeyPair pair = generator.generateKeyPair();
            privateKey = pair.getPrivate();
            publicKey = pair.getPublic();
            Files.write(privatePath, privateKey.getEncoded());
            Files.write(publicPath, publicKey.getEncoded());
            try {
                Files.setPosixFilePermissions(privatePath, Set.of(PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE));
            } catch (UnsupportedOperationException ignored) {
                // Windows and some filesystems do not expose POSIX permissions.
            }
        }
    }

    public String sign(String data) {
        try {
            Signature signature = Signature.getInstance("Ed25519");
            signature.initSign(privateKey);
            signature.update(data.getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(signature.sign());
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Unable to sign credential", e);
        }
    }

    public boolean verify(String data, String signatureValue) {
        try {
            Signature signature = Signature.getInstance("Ed25519");
            signature.initVerify(publicKey);
            signature.update(data.getBytes(StandardCharsets.UTF_8));
            return signature.verify(Base64.getUrlDecoder().decode(signatureValue));
        } catch (Exception e) {
            return false;
        }
    }

    public String registrationQrToken(String credential) {
        String payload = "REG:" + credential;
        return "EP1." + credential + "." + sign(payload);
    }

    public boolean verifyRegistrationQrToken(String token, String expectedCredential) {
        if (token == null) return false;
        String[] parts = token.trim().split("\\.", 3);
        return parts.length == 3 && parts[0].equals("EP1") && parts[1].equals(expectedCredential)
                && verify("REG:" + parts[1], parts[2]);
    }

    public String extractRegistrationCredential(String token) {
        if (token == null) return null;
        String[] parts = token.trim().split("\\.", 3);
        if (parts.length != 3 || !parts[0].equals("EP1") || !verify("REG:" + parts[1], parts[2])) return null;
        return parts[1];
    }

    public String certificateVerificationToken(String certificateId) {
        return sign("CERT:" + certificateId);
    }

    public boolean verifyCertificateToken(String certificateId, String token) {
        return certificateId != null && token != null && verify("CERT:" + certificateId, token);
    }
}
