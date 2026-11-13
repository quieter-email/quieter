import { DashboardSquare01Icon } from "@hugeicons/core-free-icons";
import { SidebarNavItem } from "@quieter/app/features/navigation/components/sidebar-nav-item";
import { SettingsScreen } from "@quieter/app/features/settings/components/settings-screen";
import { orpc } from "@quieter/app/lib/orpc";
import { Icon } from "@quieter/ui/icon";
import { useQuery } from "@tanstack/react-query";
import { createLazyFileRoute, Link } from "@tanstack/react-router";

const OperationsNavigation = ({
  onRequestClose,
}: {
  onRequestClose?: () => void;
}) => {
  const access = useQuery(orpc.operations.access.queryOptions({ gcTime: 0 }));
  if (!access.isSuccess || !access.data.allowed) {
    return null;
  }
  return (
    <SidebarNavItem
      className="justify-start text-left"
      nativeButton={false}
      onClick={onRequestClose}
      render={<Link to="/operations" />}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- SidebarNavItem renders an anchor through its render slot.
      role="link"
      size="sm"
      variant="ghost"
    >
      <Icon icon={DashboardSquare01Icon} tone="default" />
      Operations
    </SidebarNavItem>
  );
};

const SettingsRouteComponent = () => {
  const { user } = Route.useLoaderData();
  return (
    <SettingsScreen
      initialUser={user}
      renderInternalNavigation={(close) => (
        <OperationsNavigation onRequestClose={close} />
      )}
    />
  );
};

export const Route = createLazyFileRoute("/_app/settings")({
  component: SettingsRouteComponent,
});
