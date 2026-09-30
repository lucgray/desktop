import { toast } from "sonner";
import { translateCurrent } from "@/lib/i18n";

export async function copyText(text: string, message = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(message);
  } catch {
    toast.error(translateCurrent("asyncUi.couldNotCopy"));
  }
}
