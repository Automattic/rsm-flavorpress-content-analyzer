import { useState } from "react";
import { FileText, Plus, Settings } from "lucide-react";
import { ReportsPage, SettingsPage } from "./admin-pages";
import { AnalysisModal } from "./analyzer-panels";
import { AppShell, Button } from "./ui";
import { useContentAnalysis } from "./use-content-analysis";
import appIconUrl from "../src-tauri/icons/icon.png?url";

export function App() {
  const controller = useContentAnalysis();
  const [currentPageId, setCurrentPageId] = useState("reports");
  const [analysisModalOpen, setAnalysisModalOpen] = useState(false);
  const [appIconAvailable, setAppIconAvailable] = useState(true);

  function handlePageChange(pageId: string) {
    if (pageId === "reports") {
      controller.clearSelectedReport();
    }
    setCurrentPageId(pageId);
  }

  const page = currentPageId === "reports" ? (
    <ReportsPage controller={controller} />
  ) : (
    <SettingsPage controller={controller} />
  );

  return (
    <>
      <AppShell
        appName="FlavorPress"
        appIcon={
          appIconAvailable ? (
            <img
              src={appIconUrl}
              alt=""
              draggable={false}
              onError={() => setAppIconAvailable(false)}
            />
          ) : (
            "FP"
          )
        }
        currentPageId={currentPageId}
        onPageChange={handlePageChange}
        pages={[
          { id: "reports", label: "Reports", icon: <FileText aria-hidden="true" /> },
          { id: "settings", label: "Settings", icon: <Settings aria-hidden="true" /> },
        ]}
        headerAccessory={
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => {
              controller.clearError();
              setAnalysisModalOpen(true);
            }}
          >
            <Plus aria-hidden="true" />
            New analysis
          </Button>
        }
      >
        {page}
      </AppShell>
      <AnalysisModal
        open={analysisModalOpen}
        controller={controller}
        onClose={() => setAnalysisModalOpen(false)}
        onAnalysisComplete={(reportId) => {
          setAnalysisModalOpen(false);
          controller.setSelectedReportId(reportId);
          setCurrentPageId("reports");
        }}
      />
    </>
  );
}
