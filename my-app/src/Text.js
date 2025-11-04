import logo from './logo.svg';
import './App.css';
import React from 'react';
import 'devextreme/dist/css/dx.light.css';
import { TextBox } from 'devextreme-react/text-box';
import { Switch } from "devextreme-react/switch";
import RangeSlider, { Tooltip, Label } from 'devextreme-react/range-slider';

class Text extends React.Component {
    render() {
        return (
            <div>
                <div>
                    <h4>Start or Stop the Visualization Tool</h4>
                    <Switch
                        width={80}
                        rtlEnabled={true}
                    />
                </div>
            </div>
        );
    }
}

export default Text;