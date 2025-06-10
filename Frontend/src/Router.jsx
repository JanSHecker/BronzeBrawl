import FrontPage from "./FrontPage/FrontPage";
import TeamSelectionPage from "./TeamSelectionPage/TeamSelectionPage";
import ChampionSelectionPage from "./ChampionSelectionPage/ChampionSelectionPage";
import StatusPage from "./StatusPage/StatusPage";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import CreationPage from "./CreationPage/CreationPage";
import { useEffect } from "react";
import LoLApiFeed from "./LoLApi/LolApi";

const router = createBrowserRouter([
  {
    path: "/",
    element: <CreationPage />,
  },
  {
    path: "/lolApi",
    element: <LoLApiFeed />,
  },
  {
    path: "/name/:parameter",
    element: <FrontPage />,
  },
  {
    path: "/team",
    element: <TeamSelectionPage />,
  },
  {
    path: "/champion",
    element: <ChampionSelectionPage />,
  },
  {
    path: "/status",
    element: <StatusPage />,
  },
]);

const Router = () => {
  return (
    <div className="min-h-screen max-h-screen flex flex-col items-center justify-evenly m-4 ">
      <RouterProvider router={router} />
    </div>
  );
};
export default Router;
