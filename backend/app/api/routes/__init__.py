from app.api.routes import agent, areas, blocks, fx, plans, simulate, vendors

ALL = [blocks.router, areas.router, simulate.router, agent.router, plans.router, vendors.router, fx.router]
