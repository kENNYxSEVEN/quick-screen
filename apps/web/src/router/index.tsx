import { createBrowserRouter } from "react-router-dom";

import { Home } from "../pages/home";
import { NotFound } from "../pages/not-found";
import { Room } from "../pages/room";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Home />,
  },
  {
    path: "/:roomId",
    element: <Room />,
  },
  {
    path: "*",
    element: <NotFound />,
  },
]);
