export const metadata = {
  title: "LAN Lyric Imposter",
  description: "Minimal local network hidden-role lyric party game"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily: "Arial, sans-serif",
          backgroundColor: "#f5f5f5",
          color: "#111"
        }}
      >
        {children}
      </body>
    </html>
  );
}
