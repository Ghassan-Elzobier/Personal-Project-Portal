import type { MetadataRoute } from "next";

// Lets a phone add the portal to its home screen and open it like an app.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ghassan's portal",
    short_name: "Portal",
    start_url: "/",
    display: "standalone",
    background_color: "#030412",
    theme_color: "#030412",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
