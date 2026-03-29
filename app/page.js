"use client"

import { useEffect, useState } from "react"

import FlightViewerClient from "../components/FlightViewerClient"

export default function Page() {
  const [hasMounted, setHasMounted] = useState(false)

  useEffect(() => {
    setHasMounted(true)
  }, [])

  if (!hasMounted) {
    return null
  }

  return <FlightViewerClient />
}
