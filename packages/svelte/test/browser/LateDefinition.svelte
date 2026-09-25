<script lang="ts">
  import { AvalComponent, createAval } from "../../src/index.js";

  const aval = createAval(() => ({
    sources: { h264: "/missing-motion.avl" },
    autoplay: false,
    autoBind: false
  }));
</script>

<AvalComponent {aval} data-testid="player" />
<output data-testid="controller-readiness">{$aval.readiness}</output>
