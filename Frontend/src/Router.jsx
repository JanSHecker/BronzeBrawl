import FrontPage from "./FrontPage/FrontPage";
import TeamSelectionPage from "./TeamSelectionPage/TeamSelectionPage";
import ChampionSelectionPage from "./ChampionSelectionPage/ChampionSelectionPage";
import StatusPage from "./StatusPage/StatusPage";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import CreationPage from "./CreationPage/CreationPage";
import CompanionPage from "./CompanionPage/CompanionPage";
import { LiveFeedProvider } from "./LoLApi/LiveFeed";

const router = createBrowserRouter([
  {
    path: "/replays",
    element: <Navigate to="/companion" replace />,
  },
  {
    path: "/companion",
    element: <CompanionPage />,
  },
  {
    path: "/",
    element: <CreationPage />,
  },
  {
    path: "/lolApi",
    element: <Navigate to="/companion" replace />,
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
    <div className="app-shell min-h-screen flex flex-col items-center justify-evenly m-4">
      <LiveFeedProvider><RouterProvider router={router} /></LiveFeedProvider>
    </div>
  );
};
export default Router;
