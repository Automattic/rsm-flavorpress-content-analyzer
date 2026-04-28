import { AlertTriangle, FileText, Link, Play, X } from "lucide-react";
import { AnalysisActivity } from "./analysis-activity";
import {
  Alert,
  Badge,
  Button,
  Cluster,
  Dialog,
  DialogClose,
  Field,
  Input,
  Select,
  Stack,
  Textarea,
} from "./ui";
import { genreOptions, goalOptions, type ContentAnalysisController } from "./use-content-analysis";

export function AnalysisModal({
  open,
  controller,
  onClose,
  onAnalysisComplete,
}: {
  open: boolean;
  controller: ContentAnalysisController;
  onClose: () => void;
  onAnalysisComplete: (reportId: string) => void;
}) {
  return (
    <Dialog open={open} onClose={onClose} titleId="analysis-modal-title" className="analysis-dialog">
      <DialogClose aria-label="Close analysis dialog" onClick={onClose}>
        <X aria-hidden="true" />
      </DialogClose>
      <AnalyzerInputPanel controller={controller} onAnalysisComplete={onAnalysisComplete} />
    </Dialog>
  );
}

function AnalyzerInputPanel({
  controller,
  onAnalysisComplete,
}: {
  controller: ContentAnalysisController;
  onAnalysisComplete: (reportId: string) => void;
}) {
  async function handleRun() {
    const reportId = await controller.runAnalysis();
    if (reportId) {
      onAnalysisComplete(reportId);
    }
  }

  return (
    <div className="analysis-input-card">
      <div className="card__header">
        <Cluster>
          <Badge>Analyzer</Badge>
          <Badge variant="outline">Local rules</Badge>
        </Cluster>
        <h2 className="card__title" id="analysis-modal-title">
          Analyze content
        </h2>
        <p className="card__description">
          Paste text or enter one URL. Optional context is hidden unless it materially affects the result.
        </p>
      </div>

      <div className="card__content">
        <Stack>
          <div className="segmented" role="tablist" aria-label="Input mode">
            <Button
              type="button"
              variant={controller.inputMode === "text" ? "secondary" : "outline"}
              onClick={() => controller.setInputMode("text")}
            >
              <FileText aria-hidden="true" />
              Text
            </Button>
            <Button
              type="button"
              variant={controller.inputMode === "url" ? "secondary" : "outline"}
              onClick={() => controller.setInputMode("url")}
            >
              <Link aria-hidden="true" />
              URL
            </Button>
          </div>

          {controller.inputMode === "text" ? (
            <Field label="Text">
              <Textarea
                className="textarea--main"
                value={controller.text}
                onChange={(event) => controller.setText(event.target.value)}
                placeholder="Paste article, page, or draft content here."
              />
            </Field>
          ) : (
            <Field label="URL">
              <Input
                value={controller.url}
                onChange={(event) => controller.setUrl(event.target.value)}
                placeholder="https://example.com/article"
              />
            </Field>
          )}

          <details className="advanced-panel">
            <summary>Advanced context</summary>
            <Stack>
              <Field label="Genre">
                <Select
                  value={controller.genre}
                  onChange={(event) => controller.setGenre(event.target.value as typeof controller.genre)}
                >
                  {genreOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Review focus">
                <Select
                  value={controller.goal}
                  onChange={(event) => controller.setGoal(event.target.value as typeof controller.goal)}
                >
                  {goalOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Reference sources">
                <Textarea
                  value={controller.sources}
                  onChange={(event) => controller.setSources(event.target.value)}
                  placeholder="One source URL, citation, or reference per line."
                />
              </Field>
            </Stack>
          </details>

          {controller.error ? (
            <Alert variant="error">
              <AlertTriangle aria-hidden="true" />
              {controller.error}
            </Alert>
          ) : null}

          <Button type="button" onClick={() => void handleRun()} disabled={controller.loading} className="submit-button">
            <Play aria-hidden="true" />
            {controller.loading ? "Analyzing..." : "Run content analysis"}
          </Button>
          {controller.loading ? (
            <AnalysisActivity message="Analysis is running. You can close this dialog and keep working." />
          ) : null}
        </Stack>
      </div>
    </div>
  );
}
