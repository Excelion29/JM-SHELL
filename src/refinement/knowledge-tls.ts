import * as crypto from 'crypto';
import type { Duplex } from 'stream';
import * as https from 'https';
import * as tls from 'tls';

const CERT_MARKER = '-----BEGIN CERTIFICATE-----';
const HANDSHAKE_TIMEOUT_MS = 10_000;

export const fingerprintOf = (pem: string): string => new crypto.X509Certificate(pem).fingerprint256;

// Un paquete con varias cadenas ampliaría la confianza más allá del certificado que el dev confirmó
export function assertSingleCertificate(pem: string): void {
  if (pem.split(CERT_MARKER).length !== 2) throw new Error('El certificado guardado debe contener exactamente uno.');
  fingerprintOf(pem);
}

// Solo la huella del certificado hoja decide: el host y la cadena (autofirmada, con restricciones de nombre) no cuentan
export function pinnedIdentityCheck(pem: string): (cert: tls.PeerCertificate) => Error | undefined {
  const expected = fingerprintOf(pem);
  return (cert) =>
    cert.fingerprint256 === expected ? undefined : new Error('El certificado del servidor no es el que confiaste.');
}

// rejectUnauthorized queda en false SOLO porque la huella se exige antes de entregar el socket al cliente HTTP, en
// cada conexión nueva: ni los encabezados (con la API key) ni el cuerpo salen hacia un servidor con otro certificado.
// checkServerIdentity no sirve aquí: Node no lo llama cuando la cadena ya falló la verificación.
class PinnedAgent extends https.Agent {
  constructor(
    private readonly check: (cert: tls.PeerCertificate) => Error | undefined,
    private readonly handshakeTimeoutMs: number,
  ) {
    super({ keepAlive: true });
  }

  createConnection(
    options: https.RequestOptions,
    callback?: (err: Error | null, stream: Duplex) => void,
  ): Duplex | null | undefined {
    const socket = tls.connect({ ...(options as tls.ConnectionOptions), rejectUnauthorized: false });
    const fail = (err: Error) => {
      socket.destroy();
      callback?.(err, socket);
    };
    // Un servidor que no completa el handshake no debe colgar la conexión para siempre
    socket.setTimeout(this.handshakeTimeoutMs, () =>
      fail(new Error('El servidor no completó la conexión segura a tiempo.')),
    );
    socket.once('error', fail);
    socket.once('secureConnect', () => {
      socket.setTimeout(0);
      socket.removeListener('error', fail);
      socket.removeAllListeners('timeout');
      const problem = this.check(socket.getPeerCertificate());
      if (problem) fail(problem);
      else callback?.(null, socket);
    });
    return undefined;
  }
}

export function createKnowledgeAgent(
  pinnedPem?: string,
  handshakeTimeoutMs: number = HANDSHAKE_TIMEOUT_MS,
): https.Agent {
  if (pinnedPem === undefined) return new https.Agent({ keepAlive: true });
  assertSingleCertificate(pinnedPem);
  return new PinnedAgent(pinnedIdentityCheck(pinnedPem), handshakeTimeoutMs);
}
