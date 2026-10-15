import FrontPage from "./FrontPage/FrontPage";
import TeamSelectionPage from "./TeamSelectionPage/TeamSelectionPage";
import ChampionSelectionPage from "./ChampionSelectionPage/ChampionSelectionPage";
import StatusPage from "./StatusPage/StatusPage";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import CreationPage from "./CreationPage/CreationPage";
import LoLApiFeed from "./LoLApi/LolApi";
import ReplaysPage from "./ReplaysPage/ReplaysPage";
import { LiveFeedProvider } from "./LoLApi/LiveFeed";

const router = createBrowserRouter([
  {
    path: "/replays",
    element: <ReplaysPage />,
  },
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
    <div className="min-h-screen flex flex-col items-center justify-evenly m-4">
      <LiveFeedProvider><RouterProvider router={router} /></LiveFeedProvider>
    </div>
  );
};
export default Router;
