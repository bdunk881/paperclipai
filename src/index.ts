import app from "./app";
import { WORKFLOW_TEMPLATES } from "./templates";

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`AutoFlow API running on port ${PORT}`);
  console.log(`Loaded ${WORKFLOW_TEMPLATES.length} workflow templates`);
});
