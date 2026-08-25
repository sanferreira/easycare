import { useQuery } from "@tanstack/react-query";

type StripePublicConfig = {
  publishableKey: string;
  publishableKeyConfigured: boolean;
};

const buildTimePublishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY?.trim() || "";

export function useStripePublicConfig() {
  const query = useQuery<StripePublicConfig>({
    queryKey: ["/api/public/stripe-config"],
    staleTime: Infinity,
    retry: false,
  });

  const publishableKey = query.data?.publishableKey?.trim() || buildTimePublishableKey;
  const embeddedCheckoutConfigured = Boolean(publishableKey);

  return {
    ...query,
    publishableKey,
    embeddedCheckoutConfigured,
  };
}
