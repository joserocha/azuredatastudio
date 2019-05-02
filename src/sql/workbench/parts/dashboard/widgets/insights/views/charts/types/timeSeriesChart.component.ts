/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import LineChart, { ILineConfig } from './lineChart.component';
import { ChartType, defaultChartConfig, IPointDataSet } from 'sql/workbench/parts/dashboard/widgets/insights/views/charts/interfaces';

import { mixin, deepClone } from 'vs/base/common/objects';
import { Color } from 'vs/base/common/color';
import { ChangeDetectorRef, Inject, forwardRef, ElementRef } from '@angular/core';
import { IWorkbenchThemeService } from 'vs/workbench/services/themes/common/workbenchThemeService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';

const defaultTimeSeriesConfig = mixin(deepClone(defaultChartConfig), { dataType: 'point', dataDirection: 'horizontal' }) as ILineConfig;

export default class TimeSeriesChart extends LineChart {
	protected _defaultConfig = defaultTimeSeriesConfig;

	constructor(
		@Inject(forwardRef(() => ChangeDetectorRef)) _changeRef: ChangeDetectorRef,
		@Inject(forwardRef(() => ElementRef)) _el: ElementRef,
		@Inject(IWorkbenchThemeService) themeService: IWorkbenchThemeService,
		@Inject(ITelemetryService) telemetryService: ITelemetryService
	) {
		super(_changeRef, _el, themeService, telemetryService);
	}

	protected addAxisLabels(): void {
		const xLabel = this._config.xAxisLabel || this.getLabels()[1] || 'x';
		const yLabel = this._config.yAxisLabel || this.getLabels()[2] || 'y';

		const options = {
			scales: {
				xAxes: [{
					type: 'time',
					display: true,
					scaleLabel: {
						display: true,
						labelString: xLabel
					},
					ticks: {
						autoSkip: false,
						maxRotation: 45,
						minRotation: 45
					}
				}],

				yAxes: [{
					display: true,
					scaleLabel: {
						display: true,
						labelString: yLabel
					}
				}]
			}
		};

		this.options = Object.assign({}, mixin(this.options, options));
	}

	protected getDataAsPoint(): Array<IPointDataSet> {
		const dataSetMap: { [label: string]: IPointDataSet } = {};
		this._data.rows.map(row => {
			if (row && row.length >= 3) {
				const legend = row[0];
				if (!dataSetMap[legend]) {
					dataSetMap[legend] = { label: legend, data: [], fill: false };
				}
				dataSetMap[legend].data.push({ x: row[1], y: Number(row[2]) });

				if (this.chartType === ChartType.Scatter) {
					dataSetMap[legend].backgroundColor = Color.cyan;
				}
			}
		});
		return Object.values(dataSetMap);
	}
}
