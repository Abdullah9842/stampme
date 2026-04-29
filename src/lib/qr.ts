import QRCode from "qrcode";
import {
  renderToBuffer,
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";
import React from "react";
import { signEnrollmentUrl } from "@/lib/hmac";

const QR_TTL_MS = 1000 * 60 * 60 * 24 * 365; // 1 year

export async function generateEnrollmentQrDataUrl(slug: string): Promise<string> {
  const url = signEnrollmentUrl(slug, Date.now() + QR_TTL_MS);
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: "H",
    margin: 1,
    width: 1024,
    color: { dark: "#000000", light: "#FFFFFF" },
  });
}

export type PosterArgs = {
  merchantName: string;
  merchantLogoUrl: string | null;
  brandColor: string;
  slug: string;
};

const styles = StyleSheet.create({
  page: {
    padding: 36,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
  },
  header: { alignItems: "center", marginTop: 12 },
  logo: { width: 96, height: 96, objectFit: "contain", marginBottom: 12 },
  merchantName: { fontSize: 22, fontWeight: 700, marginBottom: 4 },
  enInstruction: {
    fontSize: 12,
    color: "#666",
    textAlign: "center",
    marginBottom: 12,
  },
  qrFrame: {
    padding: 12,
    borderWidth: 4,
    borderRadius: 12,
    borderStyle: "solid",
  },
  qr: { width: 320, height: 320 },
  footer: { fontSize: 8, color: "#999", marginTop: 12 },
});

export async function generateQrPosterPdf(args: PosterArgs): Promise<Buffer> {
  const qrDataUrl = await generateEnrollmentQrDataUrl(args.slug);

  const doc = React.createElement(
    Document,
    {},
    React.createElement(
      Page,
      { size: "A6", style: styles.page },
      React.createElement(
        View,
        { style: styles.header },
        args.merchantLogoUrl
          ? React.createElement(Image, {
              src: args.merchantLogoUrl,
              style: styles.logo,
            })
          : null,
        React.createElement(
          Text,
          { style: styles.merchantName },
          args.merchantName,
        ),
      ),
      React.createElement(
        Text,
        { style: styles.enInstruction },
        "Scan with your camera to get a loyalty card",
      ),
      React.createElement(
        View,
        { style: { ...styles.qrFrame, borderColor: args.brandColor } },
        React.createElement(Image, { src: qrDataUrl, style: styles.qr }),
      ),
      React.createElement(Text, { style: styles.footer }, "Powered by stampme"),
    ),
  );

  return renderToBuffer(doc);
}
