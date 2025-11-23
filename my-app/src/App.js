import logo from './logo.svg';
import './App.css';
import React from 'react';
import Chart, {
  Grid,
  ArgumentAxis,
  ValueAxis,
  CommonAxisSettings,
  CommonAxisSettingsTitle,
  Export,
  Legend,
  Label, 
  Series
} from 'devextreme-react/chart';

//https://js.devexpress.com/React/Documentation/ApiReference/UI_Components/dxChart/Configuration/valueAxis/grid/

const xaxisoptions = [
  "PRE-PREPARE",
  "PREPARE",
  "PROPOSE",
  "COMMIT",
  "REPLY"
]

const yaxisoptions = [
  "Replica 10",
  "Replica 9",
  "Replica 8",
  "Replica 7",
  "Replica 6",
  "Replica 5",
  "Replica 4",
  "Replica 3",
  "Replica 2",
  "Replica 1",
  "Primary Node"
]
class App extends React.Component {
    render() {
        return (
            <Chart
              title="pBFT Visualization Tool"
              dataSource={data}
              id="chart"
            >
                <ArgumentAxis
                    categories={xaxisoptions}
                />
                <ValueAxis
                    categories={yaxisoptions}
                />
                <Series
                      valueField="replica"
                      argumentField="action"
                      type"line"
                      color="black"
                >
                        <Label 
                            visible={true}
                            backgroundColor="grey"
                        />
                </Series>
                <Legend visible={false} />
                <CommonAxisSettings>
                    <Grid
                    visible={true}
                    color="blue"
                    opacity={0.25}
                    width={1}
                />
                </CommonAxisSettings>
                <Export enabled={true} />
            </Chart>
        );
    }
}

export default App;

//https://js.devexpress.com/React/Demos/WidgetsGallery/Demo/Charts/AjaxRequest/MaterialLimeLight/
