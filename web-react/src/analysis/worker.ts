import * as Comlink from 'comlink'
import { computeAnalysis, type AnalysisInput, type AnalysisOutput } from './pivot'

export interface AnalysisWorkerApi {
  run(input: AnalysisInput): Promise<AnalysisOutput>
}

const api: AnalysisWorkerApi = {
  async run(input) {
    return computeAnalysis(input)
  },
}

Comlink.expose(api)
