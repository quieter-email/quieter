import { LoadingSpinner } from "@quieter/app/components/loading-spinner";
import { Button } from "@quieter/ui/button";
import { Surface } from "@quieter/ui/surface";
import { Text } from "@quieter/ui/text";

export const OperationsQueryState = ({
  label,
  retry,
}: {
  label: string;
  retry?: () => void;
}) => (
  <Surface className="grid min-h-48 place-items-center">
    {retry ? (
      <div className="flex flex-col items-center gap-3 text-center">
        <Text role="alert" size="sm" tone="muted">
          {label}
        </Text>
        <Button onClick={retry} size="sm" variant="secondary">
          Try again
        </Button>
      </div>
    ) : (
      <output className="flex items-center gap-2">
        <LoadingSpinner />
        <Text size="sm" tone="muted">
          {label}
        </Text>
      </output>
    )}
  </Surface>
);
