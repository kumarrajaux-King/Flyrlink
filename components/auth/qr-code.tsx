'use client';

/**
 * An `otpauth://` URI, drawn as a QR code.
 *
 * WHY SVG AND NOT A CANVAS OR AN IMAGE
 *   An `<img>` would mean a URL, and the only URL available would carry the
 *   TOTP secret in its query string — into the browser's history, the server's
 *   access log, and any proxy in between. The secret must not travel that way,
 *   so it is never put in a URL: the URI arrives in a JSON response body and is
 *   drawn here, in the page, as vector modules that scale cleanly and stay
 *   crisp at any zoom.
 *
 *   `qrcode-generator` is a zero-dependency MIT implementation, so nothing is
 *   fetched and no secret leaves the tab.
 *
 * ACCESSIBILITY
 *   A QR code is an image of a string, and a camera is not the only way in.
 *   The `<svg>` carries a label saying what it is, and the enrollment screen
 *   shows the same secret as selectable text beside it — which is the path
 *   somebody using a desktop authenticator, or a screen reader, will take.
 */

import qrcode from 'qrcode-generator';
import { useMemo } from 'react';

/**
 * Error correction level M: ~15% recovery, the usual choice for a code shown
 * on a clean screen. Type 0 asks the library to pick the smallest version that
 * fits the data.
 */
const ERROR_CORRECTION = 'M';

export function QrCode({
  value,
  label,
  className,
}: {
  readonly value: string;
  readonly label: string;
  readonly className?: string;
}) {
  const { path, size } = useMemo(() => {
    const code = qrcode(0, ERROR_CORRECTION);
    code.addData(value);
    code.make();

    const count = code.getModuleCount();
    // One path for the whole symbol rather than a rect per module: a few
    // hundred nodes becomes one, which matters on a re-render.
    const segments: string[] = [];
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        if (code.isDark(row, column)) segments.push(`M${column} ${row}h1v1h-1z`);
      }
    }
    return { path: segments.join(''), size: count };
  }, [value]);

  // A quiet zone of 4 modules is required by the spec; without it many scanners
  // simply will not see the code.
  const quiet = 4;
  const extent = size + quiet * 2;

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${extent} ${extent}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={extent} height={extent} fill="#ffffff" />
      <g transform={`translate(${quiet} ${quiet})`}>
        <path d={path} fill="#0c2738" />
      </g>
    </svg>
  );
}
