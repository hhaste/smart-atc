import "./globals.css"

export const metadata = {
  title: "Smart ATC",
  description: "Next.js port of the Michigan Thumb live air traffic viewer."
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
