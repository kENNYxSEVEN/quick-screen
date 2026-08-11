import { RouterProvider } from "react-router-dom";

import { MediaProvider } from "./providers/media-provider";
import { ScreenProvider } from "./providers/screen-provider";
import { StreamSettingsProvider } from "./providers/stream-settings-provider";
import { router } from "./router";

export function App() {
  return (
    <ScreenProvider>
      <MediaProvider>
        <StreamSettingsProvider>
          <RouterProvider router={router} />
        </StreamSettingsProvider>
      </MediaProvider>
    </ScreenProvider>
  );
}
