package org.eventproof.config;

import org.apache.catalina.connector.Connector;
import org.apache.coyote.http11.Http11NioProtocol;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.web.embedded.tomcat.TomcatServletWebServerFactory;
import org.springframework.boot.web.server.WebServerFactoryCustomizer;
import org.springframework.context.annotation.Configuration;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

@Configuration
public class DualPortConfig implements WebServerFactoryCustomizer<TomcatServletWebServerFactory> {

    private static final Logger log = LoggerFactory.getLogger(DualPortConfig.class);

    @Override
    public void customize(TomcatServletWebServerFactory factory) {
        try {
            File dataDir = new File("./data");
            if (!dataDir.exists()) {
                dataDir.mkdirs();
            }
            File keystoreFile = new File(dataDir, "keystore.p12");
            if (!keystoreFile.exists()) {
                try (InputStream in = getClass().getResourceAsStream("/keystore.p12")) {
                    if (in != null) {
                        try (OutputStream out = new FileOutputStream(keystoreFile)) {
                            in.transferTo(out);
                        }
                    }
                }
            }

            if (keystoreFile.exists()) {
                Connector httpsConnector = new Connector(TomcatServletWebServerFactory.DEFAULT_PROTOCOL);
                httpsConnector.setPort(8443);
                httpsConnector.setSecure(true);
                httpsConnector.setScheme("https");

                Http11NioProtocol protocol = (Http11NioProtocol) httpsConnector.getProtocolHandler();
                protocol.setSSLEnabled(true);

                org.apache.tomcat.util.net.SSLHostConfig sslHostConfig = new org.apache.tomcat.util.net.SSLHostConfig();
                org.apache.tomcat.util.net.SSLHostConfigCertificate cert = 
                    new org.apache.tomcat.util.net.SSLHostConfigCertificate(sslHostConfig, org.apache.tomcat.util.net.SSLHostConfigCertificate.Type.UNDEFINED);
                cert.setCertificateKeystoreFile(keystoreFile.getAbsolutePath());
                cert.setCertificateKeystorePassword("eventproof");
                cert.setCertificateKeystoreType("PKCS12");
                cert.setCertificateKeyAlias("eventproof");
                sslHostConfig.addCertificate(cert);
                httpsConnector.addSslHostConfig(sslHostConfig);

                factory.addAdditionalTomcatConnectors(httpsConnector);
                log.info("Enabled optional HTTPS connector on port 8443 for mobile camera secure context.");
            }
        } catch (Exception e) {
            log.warn("Could not start optional HTTPS connector on port 8443: {}", e.getMessage());
        }
    }
}
