import { Link } from "expo-router";
import { View } from "react-native";

import { Text } from "#/components/ui/text";

const NotFoundRoute = () => (
  <View className="flex-1 items-center justify-center gap-3 bg-bg p-8">
    <Text className="text-title-sm font-medium">Page not found</Text>
    <Text className="text-muted-fg">
      The screen you were looking for does not exist.
    </Text>
    <Link className="text-fg underline" href="/">
      Back to mail
    </Link>
  </View>
);

export default NotFoundRoute;
