// One-off 2b validation: is trade happening + balancing agents? (seed of the 2d study)
import { createWorld } from "../state/world";
import { initResourceField, seedPopulation } from "../sim/init";
import { simStep } from "../sim/step";
import { GENE, GENE_COUNT } from "../data/genome";
import { SIM } from "../data/sim";

const w = createWorld(24301);
initResourceField(w); seedPopulation(w);
const a = w.agents;
let prevTraded = 0;
for (let t = 1; t <= 6000; t++) {
  simStep(w);
  if (a.count === 0) break;
  if (t % 2000 === 0) {
    // mean |imbalance| normalized by maxE, and fraction "breed-ready" (both stores > 0.5*REPRO*maxE)
    let sImb = 0, breedReady = 0, sTrade = 0;
    for (let i = 0; i < a.count; i++) {
      const size = a.genes[i*GENE_COUNT+GENE.SIZE]!;
      const maxE = size * SIM.maxEnergyPerSize;
      const eA = a.energy[i]!, eB = a.energyB[i]!;
      sImb += Math.abs(eA - eB) / maxE;
      const thr = a.genes[i*GENE_COUNT+GENE.REPRO_THRESHOLD]! * maxE;
      if (eA >= thr && eB >= thr) breedReady++;
      sTrade += a.genes[i*GENE_COUNT+GENE.TRADE]!;
    }
    const traded = a.tradeTotal - prevTraded; prevTraded = a.tradeTotal;
    console.log(`tick ${t}  pop ${a.count}  trades/2k ${traded}  meanImbal ${(sImb/a.count).toFixed(3)}  breedReady ${(100*breedReady/a.count).toFixed(1)}%  TRADE ${(sTrade/a.count).toFixed(2)}`);
  }
}
